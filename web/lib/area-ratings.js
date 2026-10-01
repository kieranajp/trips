export const AREA_RATINGS = Object.freeze([
  Object.freeze({ key: 'touristiness', label: 'Touristiness', emoji: '📷' }),
  Object.freeze({ key: 'foodDrink', label: 'Food & drink interest', emoji: '🍷' }),
  Object.freeze({ key: 'ourKindOfPlace', label: 'Our kind of place', emoji: '❤️' }),
]);

export function areaRatingRows(area) {
  const ratings = area?.ratings;
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) return [];
  return AREA_RATINGS.filter(({ key }) => Object.prototype.hasOwnProperty.call(ratings, key) &&
    Number.isInteger(ratings[key]) && ratings[key] >= 1 && ratings[key] <= 5)
    .map(metadata => ({ ...metadata, value: ratings[metadata.key] }));
}
