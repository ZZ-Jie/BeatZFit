/**
 * Shared grayscale color palettes for Coverflow components.
 *
 * Previously the same color arrays were duplicated across TrackCoverflow,
 * SongCoverflow, ExerciseCoverflow, and CoverflowListCard.
 */

/** 8-step grayscale — used by CoverflowListCard, TrackCoverflow, SongCoverflow, ExerciseCoverflow */
export const COVERFLOW_COLORS_8 = [
  '#E8E8E8', '#D4D4D4', '#C0C0C0', '#ACACAC',
  '#989898', '#848484', '#707070', '#5C5C5C',
] as const

/** 6-step grayscale — used by DualDeckHome (shorter decks) */
export const COVERFLOW_COLORS_6 = [
  '#E8E8E8', '#D0D0D0', '#B8B8B8', '#A0A0A0',
  '#888888', '#707070',
] as const
