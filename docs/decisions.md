# Technical decisions

## React + Vite

Chosen for a fast, modern client setup with immediate feedback during a two-day build. Vite keeps developer tooling light while React supports reusable interface components.

## Tailwind CSS

Chosen for rapid responsive UI work without maintaining a large custom stylesheet. We will keep design tokens and reusable components consistent rather than scattering arbitrary utility classes.

## Express + Socket.IO

Express provides a small, familiar REST surface; Socket.IO enables real-time request updates and is simple to demonstrate on local devices.

## MongoDB

MongoDB is planned for flexible request documents and built-in geospatial indexing. The first scaffold uses an in-memory store so the demo starts without external setup.

## OpenStreetMap + Leaflet

This avoids paid map keys for the MVP and provides the key capability: viewing location-relevant help requests.

## Optional OpenAI integration

AI adds value only where it speeds comprehension—category suggestions, summaries, and spam signals. It is server-side, optional, and never decides how an emergency should be handled.
