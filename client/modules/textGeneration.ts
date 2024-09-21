import OpenAI from "openai";
import prettyMilliseconds from "pretty-ms";
import { addLogEntry } from "./logEntries";
import {
  getQuery,
  getSearchPromise,
  getSearchResults,
  getSettings,
  getTextGenerationState,
  updateModelLoadingProgress,
  updateResponse,
  updateSearchPromise,
  updateSearchResults,
  updateSearchState,
  updateTextGenerationState,
} from "./pubSub";
import { search } from "./search";
import { getSystemPrompt } from "./systemPrompt";
import { isWebGPUAvailable } from "./webGpu";
import { untilUiIsUpdated } from "./until";

export async function prepareTextGeneration() {
  if (getQuery() === "") return;

  document.title = getQuery();

  updateResponse("");

  updateSearchResults({ textResults: [], imageResults: [] });

  updateSearchPromise(startSearch(getQuery()));

  if (!getSettings().enableAiResponse) return;

  const responseGenerationStartTime = new Date().getTime();

  updateTextGenerationState("loadingModel");

  await untilUiIsUpdated();

  try {
    const settings = getSettings();
    if (settings.inferenceType === "openai") {
      await generateTextWithOpenAI();
    } else {
      try {
        if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

        if (!settings.enableWebGpu) throw Error("WebGPU is disabled.");

        await generateTextWithWebLlm();
      } catch (error) {
        addLogEntry(`Skipping text generation with WebLLM: ${error}`);
        addLogEntry(`Starting text generation with Wllama`);
        await generateTextWithWllama();
      }
    }

    if (getTextGenerationState() !== "interrupted") {
      updateTextGenerationState("completed");
    }
  } catch (error) {
    addLogEntry(`Error generating text: ${error}`);
    updateTextGenerationState("failed");
  } finally {
    await untilUiIsUpdated();
  }

  addLogEntry(
    `Response generation took ${prettyMilliseconds(
      new Date().getTime() - responseGenerationStartTime,
      { verbose: true },
    )}`,
  );
}

async function generateTextWithOpenAI() {
  const settings = getSettings();
  const openai = new OpenAI({
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
    dangerouslyAllowBrowser: true,
  });

  await canStartResponding();

  updateTextGenerationState("preparingToGenerate");

  await untilUiIsUpdated();

  const completion = await openai.chat.completions.create({
    model: settings.openAiApiModel,
    messages: [
      {
        role: "system",
        content: getSystemPrompt(getFormattedSearchResults(true)),
      },
      { role: "user", content: getQuery() },
    ],
    temperature: 0.6,
    top_p: 0.9,
    max_tokens: 2048,
    stream: true,
  });

  let streamedMessage = "";

  for await (const chunk of completion) {
    const deltaContent = chunk.choices[0].delta.content;

    if (deltaContent) streamedMessage += deltaContent;

    if (getTextGenerationState() === "interrupted") {
      completion.controller.abort();
    } else if (getTextGenerationState() !== "generating") {
      updateTextGenerationState("generating");
    }

    updateResponseRateLimited(streamedMessage);
  }

  updateResponse(streamedMessage);
}

async function generateTextWithWebLlm() {
  const { CreateWebWorkerMLCEngine, CreateMLCEngine, hasModelInCache } =
    await import("@mlc-ai/web-llm");

  type InitProgressCallback = import("@mlc-ai/web-llm").InitProgressCallback;
  type MLCEngineConfig = import("@mlc-ai/web-llm").MLCEngineConfig;
  type ChatOptions = import("@mlc-ai/web-llm").ChatOptions;

  const selectedModelId = getSettings().webLlmModelId;

  addLogEntry(`Selected WebLLM model: ${selectedModelId}`);

  const isModelCached = await hasModelInCache(selectedModelId);

  let initProgressCallback: InitProgressCallback | undefined;

  if (isModelCached) {
    updateTextGenerationState("preparingToGenerate");
    await untilUiIsUpdated();
  } else {
    initProgressCallback = (report) => {
      updateModelLoadingProgress(Math.round(report.progress * 100));
    };
  }

  const engineConfig: MLCEngineConfig = {
    initProgressCallback,
    logLevel: "SILENT",
  };

  const chatOptions: ChatOptions = {
    temperature: 0.6,
    top_p: 0.9,
    repetition_penalty: 1.176,
  };

  const engine = Worker
    ? await CreateWebWorkerMLCEngine(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
        selectedModelId,
        engineConfig,
        chatOptions,
      )
    : await CreateMLCEngine(selectedModelId, engineConfig, chatOptions);

  if (getSettings().enableAiResponse) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    await untilUiIsUpdated();

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [
        {
          role: "system",
          content: getSystemPrompt(getFormattedSearchResults(true)),
        },
        { role: "user", content: getQuery() },
      ],
    });

    let streamedMessage = "";

    for await (const chunk of completion) {
      const deltaContent = chunk.choices[0].delta.content;

      if (deltaContent) streamedMessage += deltaContent;

      if (getTextGenerationState() === "interrupted") {
        await engine.interruptGenerate();
      } else if (getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      updateResponseRateLimited(streamedMessage);
    }

    updateResponse(streamedMessage);
  }

  addLogEntry(
    `WebLLM finished generating the response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();
}

async function generateTextWithWllama() {
  const { initializeWllama, wllamaModels } = await import("./wllama");

  let loadingPercentage = 0;

  const model = wllamaModels[getSettings().wllamaModelId];

  const wllama = await initializeWllama(model.url, {
    wllama: {
      suppressNativeLog: true,
    },
    model: {
      n_threads: getSettings().cpuThreads,
      n_ctx: model.contextSize,
      cache_type_k: model.cacheType,
      embeddings: false,
      allowOffline: true,
      progressCallback: ({ loaded, total }) => {
        const progressPercentage = Math.round((loaded / total) * 100);

        if (loadingPercentage !== progressPercentage) {
          loadingPercentage = progressPercentage;
          updateModelLoadingProgress(progressPercentage);
        }
      },
    },
  });

  if (getSettings().enableAiResponse) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    await untilUiIsUpdated();

    const prompt = await model.buildPrompt(
      wllama,
      getQuery(),
      getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
    );

    let streamedMessage = "";

    await wllama.createCompletion(prompt, {
      stopTokens: model.stopTokens,
      sampling: model.sampling,
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        if (getTextGenerationState() === "interrupted") {
          abortSignal();
        } else if (getTextGenerationState() !== "generating") {
          updateTextGenerationState("generating");
        }

        if (model.stopStrings) {
          for (const stopString of model.stopStrings) {
            if (
              currentText.slice(-(stopString.length * 2)).includes(stopString)
            ) {
              abortSignal();
              currentText = currentText.slice(0, -stopString.length);
              break;
            }
          }
        }

        streamedMessage = currentText;

        updateResponseRateLimited(streamedMessage);
      },
    });

    updateResponse(streamedMessage);
  }

  await wllama.exit();
}

function getFormattedSearchResults(shouldIncludeUrl: boolean) {
  const searchResults = getSearchResults().textResults.slice(
    0,
    getSettings().searchResultsToConsider,
  );

  if (searchResults.length === 0) return "None.";

  if (shouldIncludeUrl) {
    return searchResults
      .map(
        ([title, snippet, url], index) =>
          `${index + 1}. [${title}](${url}) | ${snippet}`,
      )
      .join("\n");
  }

  return searchResults
    .map(([title, snippet]) => `- ${title} | ${snippet}`)
    .join("\n");
}

async function getKeywords(text: string, limit?: number) {
  return (await import("keyword-extractor")).default
    .extract(text, { language: "english" })
    .slice(0, limit);
}

async function startSearch(query: string) {
  updateSearchState("running");

  await untilUiIsUpdated();

  let searchResults = await search(
    query.length > 2000 ? (await getKeywords(query, 20)).join(" ") : query,
    30,
  );

  if (searchResults.textResults.length === 0) {
    const queryKeywords = await getKeywords(query, 10);

    searchResults = await search(queryKeywords.join(" "), 30);
  }

  updateSearchState(
    searchResults.textResults.length === 0 ? "failed" : "completed",
  );

  updateSearchResults(searchResults);

  await untilUiIsUpdated();

  return searchResults;
}

async function canStartResponding() {
  if (getSettings().searchResultsToConsider > 0) {
    updateTextGenerationState("awaitingSearchResults");
    await untilUiIsUpdated();
    await getSearchPromise();
  }
}

function updateResponseRateLimited(text: string) {
  const currentTime = Date.now();

  if (
    currentTime - updateResponseRateLimited.lastUpdateTime >=
    updateResponseRateLimited.updateInterval
  ) {
    updateResponse(text);
    updateResponseRateLimited.lastUpdateTime = currentTime;
  }
}
updateResponseRateLimited.lastUpdateTime = 0;
updateResponseRateLimited.updateInterval = 1000 / 12;
