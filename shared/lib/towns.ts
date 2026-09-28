/** The towns and settlements of the Sea-to-Sky and round it: name,
 *  longitude, latitude. Approximate positions, enough for "near" (the Data
 *  Sandbox names its best places by the nearest) and for flying the map to
 *  one found by the search. */
export const TOWNS: [string, number, number][] = [
  ['Squamish', -123.156, 49.702], ['Brackendale', -123.157, 49.771], ['Britannia Beach', -123.203, 49.625],
  ['Lions Bay', -123.236, 49.458], ['Horseshoe Bay', -123.273, 49.373], ['Whistler', -122.957, 50.116],
  ['Pemberton', -122.803, 50.319], ['Mount Currie', -122.717, 50.32], ["D'Arcy", -122.48, 50.549],
  ['Birken', -122.62, 50.48], ['Lillooet', -121.937, 50.686], ['Seton Portage', -122.292, 50.706],
  ['Gold Bridge', -122.841, 50.853], ['Gibsons', -123.508, 49.399], ['Sechelt', -123.755, 49.474],
  ['Pender Harbour', -124.03, 49.63], ['Egmont', -123.93, 49.75], ['Powell River', -124.525, 49.835],
  ['Vancouver', -123.121, 49.283], ['Harrison Hot Springs', -121.786, 49.301], ['Hope', -121.442, 49.386],
  ['Chilliwack', -121.952, 49.158], ['Mission', -122.311, 49.134], ['Bralorne', -122.816, 50.778],
  ['Lytton', -121.582, 50.232], ['Boston Bar', -121.444, 49.866], ['Port Mellon', -123.486, 49.523],
];

/** The main mountains and lakes, for the map's search to find by name: name,
 *  kind, longitude, latitude, as the BC Geographical Names Office has them
 *  (apps.gov.bc.ca/pub/bcgnws; where more than one has the name, the one by
 *  Whistler). Kept apart from TOWNS, which the Data Sandbox names places by. */
export const LANDMARKS: [string, 'mountain' | 'lake', number, number][] = [
  ["Blackcomb Peak", 'mountain', -122.871, 50.081], ["Castle Towers Mountain", 'mountain', -122.942, 49.94],
  ["Cayoosh Mountain", 'mountain', -122.524, 50.402], ["Joffre Peak", 'mountain', -122.446, 50.341],
  ["Mamquam Mountain", 'mountain', -122.851, 49.775], ["Mount Currie", 'mountain', -122.782, 50.249],
  ["Mount Garibaldi", 'mountain', -123.005, 49.851], ["Mount Matier", 'mountain', -122.444, 50.326],
  ["Mount Sir Richard", 'mountain', -122.701, 49.964], ["Mount Tantalus", 'mountain', -123.329, 49.818],
  ["Sky Pilot Mountain", 'mountain', -123.086, 49.635],
  ["Stawamus Chief Mountain", 'mountain', -123.142, 49.684],
  ["The Black Tusk", 'mountain', -123.043, 49.975], ["Wedge Mountain", 'mountain', -122.793, 50.133],
  ["Whistler Mountain", 'mountain', -122.957, 50.059],
  ["Alice Lake", 'lake', -123.122, 49.779], ["Alta Lake", 'lake', -122.982, 50.115],
  ["Anderson Lake", 'lake', -122.41, 50.633], ["Birkenhead Lake", 'lake', -122.693, 50.535],
  ["Brohm Lake", 'lake', -123.136, 49.821], ["Callaghan Lake", 'lake', -123.189, 50.197],
  ["Carpenter Lake", 'lake', -122.552, 50.863], ["Cheakamus Lake", 'lake', -122.919, 50.011],
  ["Daisy Lake", 'lake', -123.128, 49.992], ["Duffey Lake", 'lake', -122.316, 50.402],
  ["Garibaldi Lake", 'lake', -123.026, 49.937], ["Green Lake", 'lake', -122.936, 50.15],
  ["Levette Lake", 'lake', -123.189, 49.832], ["Lillooet Lake", 'lake', -122.496, 50.246],
  ["Lost Lake", 'lake', -122.937, 50.128], ["Lower Joffre Lake", 'lake', -122.497, 50.366],
  ["Seton Lake", 'lake', -122.126, 50.688],
];
