import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { createMap } from './map/createMap';

const container = document.getElementById('map');
if (!container) throw new Error('#map fehlt in index.html');

createMap(container);
