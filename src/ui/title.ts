import type { CSSProperties } from 'react'

// Profile names run up to ~45 characters. Long names drop to one smaller size and are capped at a
// number of lines with an ellipsis, so cards never grow or push the chart below them.
export interface TitleFit { size: number; longSize: number; maxChars: number; lines: number }

export const MAIN_TITLE: TitleFit = { size: 44, longSize: 32, maxChars: 20, lines: 2 }
export const SIDE_TITLE: TitleFit = { size: 26, longSize: 20, maxChars: 14, lines: 3 }

export function titleStyle(title: string, fit: TitleFit): CSSProperties {
  const long = title.length > fit.maxChars
  return {
    fontSize: long ? fit.longSize : fit.size,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: fit.lines,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  }
}
