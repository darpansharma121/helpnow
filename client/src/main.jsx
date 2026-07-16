import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const requests = [
  { category: 'Medical', title: 'Need O+ blood donor', place: 'City Hospital · 1.2 km', urgency: 'Critical', color: 'bg-rose-500' },
  { category: 'Transport', title: 'Bike puncture on GS Road', place: 'Bhangagarh · 2.5 km', urgency: 'Urgent', color: 'bg-amber-500' },
  { category: 'Essentials', title: 'Medicine pickup for senior', place: 'Zoo Road · 3.1 km', urgency: 'Normal', color: 'bg-sky-500' },
]

function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a className="text-xl font-bold tracking-tight" href="#top">Help<span className="text-teal-400">Now</span></a>
        <div className="flex items-center gap-3"><button className="text-sm text-slate-300 hover:text-white">How it works</button><button className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-300">Offer help</button></div>
      </nav>
      <section id="top" className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[1.1fr_.9fr] lg:py-24">
        <div><p className="mb-4 inline-flex rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-sm font-medium text-teal-300">Local help, when it matters</p><h1 className="max-w-3xl text-5xl font-bold leading-tight tracking-tight sm:text-6xl">A nearby neighbour can make the difference.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">Post an urgent need and reach people nearby who can help—from blood donations and medicine pickups to roadside support.</p><div className="mt-8 flex flex-wrap gap-3"><button className="rounded-lg bg-teal-400 px-5 py-3 font-semibold text-slate-950 hover:bg-teal-300">I need help</button><button className="rounded-lg border border-slate-700 px-5 py-3 font-semibold text-slate-100 hover:border-slate-500">Browse requests</button></div><p className="mt-5 text-sm text-slate-400">For immediate danger, contact official emergency services first.</p></div>
        <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-teal-950/30"><div className="mb-5 flex items-center justify-between"><div><p className="font-semibold">Requests near you</p><p className="text-sm text-slate-400">Guwahati · Live demo</p></div><span className="h-2.5 w-2.5 rounded-full bg-teal-400 shadow-[0_0_12px_3px_rgba(45,212,191,.35)]" /></div><div className="space-y-3">{requests.map((request) => <article key={request.title} className="rounded-xl border border-slate-800 bg-slate-950 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-teal-300">{request.category}</p><h2 className="mt-1 font-semibold">{request.title}</h2><p className="mt-2 text-sm text-slate-400">{request.place}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold text-white ${request.color}`}>{request.urgency}</span></div></article>)}</div></aside>
      </section>
      <section className="border-y border-slate-800 bg-slate-900/40"><div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-3"><div><p className="text-3xl font-bold text-teal-300">&lt; 1 min</p><p className="mt-2 text-slate-300">to create a clear request</p></div><div><p className="text-3xl font-bold text-teal-300">Real-time</p><p className="mt-2 text-slate-300">updates for nearby helpers</p></div><div><p className="text-3xl font-bold text-teal-300">Privacy-first</p><p className="mt-2 text-slate-300">approximate location by default</p></div></div></section>
    </main>
  )
}

createRoot(document.getElementById('app')).render(<StrictMode><App /></StrictMode>)
