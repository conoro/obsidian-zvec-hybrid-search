export interface ResultPointerEvent {
  type: string;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface ResultActivation {
  newTab: boolean;
  preventDefault: boolean;
}

export function resultActivationFor(
  event: ResultPointerEvent,
): ResultActivation | null {
  const primaryClick = event.type === 'click' && event.button === 0;
  const middleClick = event.type === 'auxclick' && event.button === 1;
  if (!primaryClick && !middleClick) return null;

  return {
    newTab: middleClick || event.ctrlKey || event.metaKey,
    preventDefault: middleClick,
  };
}
