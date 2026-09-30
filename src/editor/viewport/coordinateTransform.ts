/**
 * Converts pointer screen coordinates to source image pixel coordinates.
 * The Konva stage applies scale (zoom) and offset (pan) transforms.
 * We must invert these to get source-image coords.
 */
export interface ViewportTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number; // stage x position
  offsetY: number; // stage y position
  stageX: number;  // stage left in DOM
  stageY: number;  // stage top in DOM
}

/**
 * Convert DOM pointer position to source image pixel coordinates.
 * @param screenX pointer x relative to document
 * @param screenY pointer y relative to document
 * @param transform current viewport transform
 */
export function screenToImageCoords(
  screenX: number,
  screenY: number,
  transform: ViewportTransform
): { x: number; y: number } {
  // Screen position relative to stage element
  const relX = screenX - transform.stageX;
  const relY = screenY - transform.stageY;

  // Invert the stage transform: pos = (rel - offset) / scale
  const x = (relX - transform.offsetX) / transform.scaleX;
  const y = (relY - transform.offsetY) / transform.scaleY;

  return { x, y };
}

/**
 * Convert source image pixel coordinates to screen coordinates.
 */
export function imageToScreenCoords(
  imageX: number,
  imageY: number,
  transform: ViewportTransform
): { x: number; y: number } {
  const x = imageX * transform.scaleX + transform.offsetX + transform.stageX;
  const y = imageY * transform.scaleY + transform.offsetY + transform.stageY;
  return { x, y };
}
