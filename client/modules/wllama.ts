import {
  type LoadModelConfig,
  type SamplingConfig,
  Wllama,
  type WllamaChatMessage,
  type WllamaConfig,
} from "@wllama/wllama";
import type { DownloadOptions } from "@wllama/wllama/esm/cache-manager";
import multiThreadWllamaWasmUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import singleThreadWllamaWasmUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import { addLogEntry } from "./logEntries";
import { getSettings } from "./pubSub";
import { getSystemPrompt } from "./systemPrompt";
import { defaultContextSize } from "./textGenerationUtilities";

interface WllamaInitConfig {
  wllama?: WllamaConfig;
  model?: LoadModelConfig & DownloadOptions;
}

async function createWllamaInstance(config?: {
  wllama?: WllamaConfig;
}): Promise<Wllama> {
  try {
    return new Wllama(
      {
        "single-thread/wllama.wasm": singleThreadWllamaWasmUrl,
        "multi-thread/wllama.wasm": multiThreadWllamaWasmUrl,
      },
      config?.wllama,
    );
  } catch (error) {
    addLogEntry(
      `Failed to create Wllama instance: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export async function initializeWllama(
  hfRepoId: string,
  hfFilePath: string,
  config?: WllamaInitConfig,
): Promise<Wllama> {
  addLogEntry("Initializing Wllama");

  try {
    const wllama = await createWllamaInstance(config);
    await wllama.loadModelFromHF(hfRepoId, hfFilePath, config?.model);
    addLogEntry("Wllama initialized successfully");
    return wllama;
  } catch (error) {
    addLogEntry(
      `Failed to initialize Wllama: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export async function clearWllamaCache(): Promise<Wllama> {
  addLogEntry("Clearing Wllama cache");

  try {
    const wllama = await createWllamaInstance();
    await wllama.cacheManager.clear();
    addLogEntry("Wllama cache cleared successfully");
    return wllama;
  } catch (error) {
    addLogEntry(
      `Failed to clear Wllama cache: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export interface WllamaModel {
  readonly label: string;
  readonly hfRepoId: string;
  readonly hfFilePath: string;
  readonly cacheTypeK: LoadModelConfig["cache_type_k"];
  readonly cacheTypeV: LoadModelConfig["cache_type_v"];
  readonly contextSize: number;
  readonly fileSizeInMegabytes: number;
  readonly shouldIncludeUrlsOnPrompt: boolean;
  readonly stopStrings?: string[];
  readonly stopTokens?: number[];
  getSampling: () => SamplingConfig;
  getMessages: (query: string, searchResults: string) => WllamaChatMessage[];
}

const createDefaultModelConfig = (): Omit<
  WllamaModel,
  "label" | "fileSizeInMegabytes" | "hfRepoId" | "hfFilePath"
> => ({
  getMessages: (query, searchResults) => [
    { role: "user", content: getSystemPrompt(searchResults) },
    { role: "assistant", content: "Ok!" },
    { role: "user", content: query },
  ],
  cacheTypeK: "q4_0",
  cacheTypeV: "q8_0",
  contextSize: defaultContextSize,
  shouldIncludeUrlsOnPrompt: true,
  getSampling: () => {
    const settings = getSettings();
    return {
      top_p: settings.inferenceTopP,
      temp: settings.inferenceTemperature,
      penalty_freq: settings.inferenceFrequencyPenalty,
      penalty_present: settings.inferencePresencePenalty,
      min_p: 0.05,
      top_k: 0,
      typical_p: 0.2,
    };
  },
});

export const wllamaModels: Readonly<Record<string, WllamaModel>> = {
  "smollm2-135m": {
    ...createDefaultModelConfig(),
    label: "SmolLM 2 135M",
    hfRepoId: "Felladrin/gguf-Q8_0-SmolLM2-135M-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 145,
  },
  "smollm2-360m": {
    ...createDefaultModelConfig(),
    label: "SmolLM 2 360M",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmolLM2-360M-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 260,
  },
  "qwen-2.5-0.5b": {
    ...createDefaultModelConfig(),
    label: "Qwen 2.5 0.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Qwen2.5-0.5B-Instruct",
    hfFilePath: "model.shard-00001-of-00003.gguf",
    fileSizeInMegabytes: 386,
  },
  "amd-olmo-1b": {
    ...createDefaultModelConfig(),
    label: "AMD OLMo 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-AMD-OLMo-1B-SFT-DPO",
    hfFilePath: "model.shard-00001-of-00009.gguf",
    fileSizeInMegabytes: 697,
  },
  "granite-3.1-1b": {
    ...createDefaultModelConfig(),
    label: "Granite 3.1 1B [400M]",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-granite-3.1-1b-a400m-instruct",
    hfFilePath: "model.shard-00001-of-00020.gguf",
    fileSizeInMegabytes: 775,
  },
  "llama-3.2-1b": {
    ...createDefaultModelConfig(),
    label: "Llama 3.2 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Llama-3.2-1B-Instruct",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 776,
  },
  "falcon-3-1b": {
    ...createDefaultModelConfig(),
    label: "Falcon 3 1B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Falcon3-1B-Instruct",
    hfFilePath: "model.shard-00001-of-00005.gguf",
    fileSizeInMegabytes: 1020,
  },
  "pythia-1.4b": {
    ...createDefaultModelConfig(),
    label: "Pythia 1.4B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-pythia-1.4b-sft-full",
    hfFilePath: "model.shard-00001-of-00010.gguf",
    fileSizeInMegabytes: 833,
  },
  "pints-1.5b": {
    ...createDefaultModelConfig(),
    label: "Pints 1.5B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-1.5-Pints-16K-v0.1",
    hfFilePath: "model.shard-00001-of-00018.gguf",
    fileSizeInMegabytes: 905,
  },
  "smollm2-1.7b": {
    ...createDefaultModelConfig(),
    label: "SmolLM 2 1.7B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmolLM2-1.7B-Instruct",
    hfFilePath: "model.shard-00001-of-00012.gguf",
    fileSizeInMegabytes: 999,
  },
  "internlm-2.5-1.8b": {
    ...createDefaultModelConfig(),
    label: "InternLM 2.5 1.8B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-internlm2_5-1_8b-chat",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 1120,
  },
  "arcee-lite": {
    ...createDefaultModelConfig(),
    label: "Arcee Lite 1.5B",
    hfRepoId: "Felladrin/gguf-q5_k_l-imat-arcee-lite",
    hfFilePath: "arcee-lite-Q5_K_L.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1430,
  },
  "granite-3.1-2b": {
    ...createDefaultModelConfig(),
    label: "Granite 3.1 2B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-granite-3.1-2b-instruct",
    hfFilePath: "model.shard-00001-of-00019.gguf",
    fileSizeInMegabytes: 1460,
  },
  "exaone-3.5-2.4b": {
    ...createDefaultModelConfig(),
    label: "EXAONE 3.5 2.4B",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K_M-EXAONE-3.5-2.4B-Instruct",
    hfFilePath: "model.shard-00001-of-00009.gguf",
    fileSizeInMegabytes: 1910,
    cacheTypeV: "f16",
  },
  "falcon-3-3b": {
    ...createDefaultModelConfig(),
    label: "Falcon 3 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Falcon3-3B-Instruct",
    hfFilePath: "model.shard-00001-of-00006.gguf",
    fileSizeInMegabytes: 1930,
  },
  "gemma-2-2b": {
    ...createDefaultModelConfig(),
    label: "Gemma 2 2B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-gemma-2-2b-it",
    hfFilePath: "model.shard-00001-of-00004.gguf",
    fileSizeInMegabytes: 1640,
  },
  "smallthinker-3b": {
    ...createDefaultModelConfig(),
    label: "SmallThinker 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-SmallThinker-3B-Preview",
    hfFilePath: "model.shard-00001-of-00008.gguf",
    fileSizeInMegabytes: 2010,
  },
  "llama-3.2-3b": {
    ...createDefaultModelConfig(),
    label: "Llama 3.2 3B",
    hfRepoId: "Felladrin/gguf-sharded-Q5_K_L-Llama-3.2-3B-Instruct",
    hfFilePath: "model.shard-00001-of-00007.gguf",
    fileSizeInMegabytes: 2420,
  },
  "granite-3.1-3b": {
    ...createDefaultModelConfig(),
    label: "Granite 3.1 3B [800M]",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-granite-3.1-3b-a800m-instruct",
    hfFilePath: "model.shard-00001-of-00033.gguf",
    fileSizeInMegabytes: 1900,
  },
  "minicpm3-4b": {
    ...createDefaultModelConfig(),
    label: "MiniCPM 3 4B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-MiniCPM3-4B",
    hfFilePath: "model.shard-00001-of-00016.gguf",
    fileSizeInMegabytes: 2360,
    contextSize: 2688,
  },
  "phi-3.5-mini-3.8b": {
    ...createDefaultModelConfig(),
    label: "Phi 3.5 Mini 3.8B",
    hfRepoId: "Felladrin/gguf-sharded-Q4_K_S-Phi-3.5-mini-instruct",
    hfFilePath: "model.shard-00001-of-00034.gguf",
    fileSizeInMegabytes: 2190,
  },
  "magpielm-4b": {
    ...createDefaultModelConfig(),
    label: "MagpieLM 4B",
    hfRepoId: "Felladrin/gguf-Q5_K_M-MagpieLM-4B-Chat-v0.1",
    hfFilePath: "magpielm-4b-chat-v0-00001-of-00019.gguf",
    fileSizeInMegabytes: 3230,
  },
  "nemotron-mini-4b": {
    ...createDefaultModelConfig(),
    label: "Nemotron Mini 4B",
    hfRepoId: "Felladrin/gguf-Q5_K_M-Nemotron-Mini-4B-Instruct",
    hfFilePath: "nemotron-mini-4b-instruct-q5_k_m-imat-00001-of-00004.gguf",
    fileSizeInMegabytes: 3550,
  },
  "olmoe-1b-7b": {
    ...createDefaultModelConfig(),
    label: "OLMoE 7B [1B]",
    hfRepoId: "Felladrin/gguf-sharded-Q3_K_XL-OLMoE-1B-7B-0924-Instruct",
    hfFilePath: "OLMoE-1B-7B-0924-Instruct-Q3_K_XL.shard-00001-of-00050.gguf",
    fileSizeInMegabytes: 3700,
    contextSize: 3456,
  },
};
