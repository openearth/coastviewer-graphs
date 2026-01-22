# Coastviewer Graphs

A Vue.js web application for visualizing coastal transect data from the JARKUS dataset. The application displays altitude profiles over time for specific transects along the Dutch coast, with interactive charts and detailed metadata.

## Tech Stack

- **Vue 3** - Progressive JavaScript framework (Composition API)
- **Vuetify 3** - Material Design component framework
- **ECharts 6** - Interactive charting library
- **Pinia** - State management
- **Vue Router 4** - Client-side routing
- **Vite** - Build tool and dev server

## Features

- Interactive line charts showing altitude profiles across multiple years
- Transect selection via URL routing (`/:transectNum`)
- Side panel displaying transect metadata:
  - Alongshore distance
  - Area code and name
  - RSP coordinates (lat/lon and projected x/y)
  - Mean low/high water levels
- LocalStorage caching for faster subsequent loads
- Automatic transect normalization (snaps to nearest valid transect)
- Responsive design with data zoom capabilities

## Data Source

Data is fetched from Deltares OpenDAP THREDDS server:
- **Base URL**: `https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii`
- **Dataset**: JARKUS (JAnkRichting KUSt) coastal monitoring data
- **Format**: OpenDAP ASCII responses parsed client-side

## Project Setup

```bash
npm install
```

## Development

Start the development server (runs on port 3000):

```bash
npm run dev
```

## Build

Compile and minify for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Linting

Lint and automatically fix files:

```bash
npm run lint
```

## Project Structure

```
src/
├── components/     # Vue components (SidePanel)
├── views/          # Page views (Home)
├── stores/         # Pinia stores (app state management)
├── router/         # Vue Router configuration
├── plugins/        # Vue plugins (Vuetify, etc.)
└── styles/         # Global styles and SCSS variables
```

## Default Transect

The application defaults to transect `1000475` if no transect number is specified in the URL.
