# HelpNow

> Real-time local help coordination for urgent community needs.

HelpNow helps people ask for and offer nearby assistance when time matters. A person can post a request—such as a blood donation need, vehicle breakdown, medicine pickup, lost item, or disaster-related help—share their approximate location, and be matched with capable community helpers.

## Hackathon MVP

- Create and browse location-aware help requests
- Classify requests by category and urgency
- Find nearby requests on a map and in a feed
- Accept a request and update its status in real time
- Protect the experience with input validation and basic spam checks

## Tech stack

| Area | Technology |
| --- | --- |
| Web client | React, Vite, Tailwind CSS |
| API | Node.js, Express |
| Real-time updates | Socket.IO |
| Database (planned) | MongoDB + Mongoose |
| Map (planned) | Leaflet + OpenStreetMap |
| AI assistance (planned) | OpenAI API |

## Project layout

```text
helpnow/
├── client/          # React application
├── server/          # Express API and Socket.IO server
├── docs/            # Product and engineering documentation
└── .env.example     # Environment-variable template
```

## Getting started

Prerequisites: Node.js 20+ and npm 10+.

```bash
git clone <your-repository-url>
cd helpnow
cp .env.example server/.env

cd server
npm install
npm run dev
```

In a second terminal:

```bash
cd client
npm install
npm run dev
```

The client runs on `http://localhost:5173` and the API on `http://localhost:3000` by default.

## Documentation

- [Vision](docs/vision.md)
- [Problem statement](docs/problem-statement.md)
- [MVP features](docs/features.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/database-schema.md)
- [API design](docs/api-design.md)
- [User flow](docs/user-flow.md)
- [Future roadmap](docs/future-roadmap.md)
- [Technical decisions](docs/decisions.md)

## Contributing

This is a hackathon MVP. Keep changes focused, use conventional commits, and update the corresponding documentation when behaviour changes.

## License

Distributed under the [MIT License](LICENSE).
