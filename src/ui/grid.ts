// Positions on the display's dot grid. Anything that draws dots on the display must start at a multiple
// of the pitch from the display's padding-box corner, or its dots won't line up with the background.
export const PITCH = 9
export const snapDown = (px: number, pitch = PITCH) => Math.max(0, Math.floor(px / pitch) * pitch)
