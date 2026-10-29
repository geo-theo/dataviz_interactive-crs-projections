export function prepareCountries(features) {
  // Natural Earth omits ISO numeric IDs for a few territories. Give those
  // features stable namespaced keys for both dropdown and shareable URL state.
  return features.map(feature => ({
    ...feature,
    id: String(feature.id ?? `name:${feature.properties.name}`),
  })).sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'en'));
}
