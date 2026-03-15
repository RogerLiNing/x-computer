import { useDesktopStore } from '@/store/desktopStore';
import { AppWindowFrame } from './AppWindowFrame';

export function WindowManager() {
  const windows = useDesktopStore((s) => s.windows);

  return (
    <>
      {windows.map((win) =>
        win.isMinimized ? null : <AppWindowFrame key={win.id} window={win} />,
      )}
    </>
  );
}
