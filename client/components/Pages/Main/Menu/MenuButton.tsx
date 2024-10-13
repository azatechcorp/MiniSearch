import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@mantine/core";
import { addLogEntry } from "../../../../modules/logEntries";

const MenuDrawer = lazy(() => import("./MenuDrawer"));

export default function MenuButton() {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isDrawerLoaded, setDrawerLoaded] = useState(false);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    addLogEntry("User opened the menu");
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    addLogEntry("User closed the menu");
  }, []);

  const handleDrawerLoad = useCallback(() => {
    if (!isDrawerLoaded) {
      addLogEntry("Menu drawer loaded");
      setDrawerLoaded(true);
    }
  }, [isDrawerLoaded]);

  const DrawerFallback = () => {
    useEffect(() => {
      return () => handleDrawerLoad();
    }, []);
    return null;
  };

  return (
    <>
      <Button
        size="xs"
        onClick={openDrawer}
        variant="default"
        loading={isDrawerOpen && !isDrawerLoaded}
      >
        Menu
      </Button>
      {(isDrawerOpen || isDrawerLoaded) && (
        <Suspense fallback={<DrawerFallback />}>
          <MenuDrawer onClose={closeDrawer} opened={isDrawerOpen} />
        </Suspense>
      )}
    </>
  );
}
