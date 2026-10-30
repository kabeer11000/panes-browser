/** Landscapes and skies only: ids on picsum.photos (Unsplash photos), picked by eye from the first hundred. */
export const PHOTO_IDS: readonly number[] = [
  10, 11, 12, 13, 14, 15, 16, 17, 28, 29, 37, 38, 46, 53, 54, 62, 66, 77, 83, 87, 93
]

/** The photo for a day: a new one each day, the same all day. */
export function dailyPhotoId(d: Date): number {
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
  return PHOTO_IDS[day % PHOTO_IDS.length]
}

/** The photo after `id` in the list (the first when `id` is not in it). */
export const nextPhotoId = (id: number): number =>
  PHOTO_IDS[(PHOTO_IDS.indexOf(id) + 1) % PHOTO_IDS.length]

export const photoUrl = (id: number, width = 1920, height = 1080): string =>
  `https://picsum.photos/id/${id}/${width}/${height}`
