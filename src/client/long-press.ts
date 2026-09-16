export type PressPoint = { x: number; y: number };

/** Cancel on release, scrolling movement, pointer cancellation, or unmount. */
export function createLongPress(onHold: (point: PressPoint) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: PressPoint | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    origin = undefined;
  };
  return {
    cancel,
    start(point: PressPoint) {
      cancel();
      origin = point;
      timer = setTimeout(() => {
        cancel();
        onHold(point);
      }, 550);
    },
    move(point: PressPoint) {
      if (origin && Math.hypot(point.x - origin.x, point.y - origin.y) > 10)
        cancel();
    },
  };
}
