# Technical decisions

## React + Vite

Chosen for a fast, modern client setup with immediate feedback during a two-day build. Vite keeps developer tooling light while React supports reusable interface components.

## Tailwind CSS

Chosen for rapid responsive UI work without maintaining a large custom stylesheet. We will keep design tokens and reusable components consistent rather than scattering arbitrary utility classes.

## Express + Socket.IO

Express provides a small, familiar REST surface; Socket.IO enables real-time request updates and is simple to demonstrate on local devices.

## Supabase Auth + PostgreSQL

Supabase provides email/password authentication, PostgreSQL persistence, and Row Level Security. Each API request uses the caller's access token rather than a privileged service key. PostgreSQL functions serialize request claiming and authorize lifecycle transitions.

## OpenStreetMap + Leaflet

This avoids paid map keys for the MVP and provides the key capability: viewing location-relevant help requests.

## Optional OpenAI integration

AI adds value only where it speeds comprehension—category suggestions, summaries, and spam signals. It is server-side, optional, and never decides how an emergency should be handled.
