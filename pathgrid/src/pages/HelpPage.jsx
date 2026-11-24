import { Link } from 'react-router-dom';
import { Accessibility, ArrowLeft, Ban, Layers, QrCode, Route } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import LegendSwatch from '../components/LegendSwatch';
import { LEGEND_ITEMS } from '../components/mapStyles';

function Section({ id, icon: Icon, title, children }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id={id} className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-900">
        <Icon aria-hidden="true" className="h-5 w-5 text-blue-700" />
        {title}
      </h2>
      <div className="space-y-3 text-base leading-relaxed text-slate-800">{children}</div>
    </section>
  );
}

/**
 * Help & Map Legend page.
 */
export default function HelpPage() {
  return (
    <div className="min-h-dvh bg-slate-100">
      <AppHeader subtitle="Help & map legend" />

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Help &amp; Map Legend</h1>
          <Link
            to="/"
            className="flex h-12 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            <ArrowLeft aria-hidden="true" className="h-5 w-5" />
            Back to map
          </Link>
        </div>

        <Section id="help-route" icon={Route} title="Finding a route">
          <ol className="list-decimal space-y-1 pl-6">
            <li>Choose your <strong>Start location</strong>, or scan a PathGrid QR code to set it automatically.</li>
            <li>Choose your <strong>Destination</strong>.</li>
            <li>Turn on <strong>Wheelchair accessible route</strong> if you need a step-free path.</li>
            <li>Tap <strong>Find Route</strong>. Your path is drawn in blue and step-by-step directions appear below.</li>
            <li>
              When your route changes floors, tap <strong>Switch to Floor X</strong> or use the floor buttons on the
              right. Floors on your route show a small dot.
            </li>
          </ol>
          <p>Pinch or use the + and − buttons to zoom. Drag to move around the map.</p>
        </Section>

        <Section id="help-legend" icon={Layers} title="Map legend">
          <ul className="divide-y divide-slate-200">
            {LEGEND_ITEMS.map((item) => (
              <li key={item.key} className="flex items-center gap-3 py-2.5">
                <LegendSwatch kind={item.key} />
                <span>
                  <span className="block font-semibold text-slate-900">{item.label}</span>
                  <span className="block text-sm text-slate-700">{item.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="help-wheelchair" icon={Accessibility} title="Wheelchair Mode">
          <p>
            With Wheelchair Mode on, PathGrid only uses step-free paths. Stairs, steps and rooms without step-free
            access are left out, and floor changes always use a working elevator.
          </p>
          <p>
            Rooms that can&apos;t be reached step-free are marked <em>(not step-free)</em> in the destination list.
            If there is no step-free route right now, you&apos;ll see a message explaining why.
          </p>
        </Section>

        <Section id="help-out-of-service" icon={Ban} title="Out-of-service elevators and closures">
          <p>
            Facility staff can mark an elevator or passage as out of service. It appears grey with a red cross, or as a
            red dashed line. Routes avoid it for everyone.
          </p>
          <p>
            If a change affects the route you are following, PathGrid recalculates it automatically and shows
            <em> &ldquo;Route updated due to facility change.&rdquo;</em>
          </p>
        </Section>

        <Section id="help-qr" icon={QrCode} title="QR codes and offline use">
          <p>
            QR codes on the walls open PathGrid with your current location already set as the start point. No app
            download or login is needed.
          </p>
          <p>
            Once a building map has loaded, routing keeps working without a connection, because all route
            calculations happen on your device.
          </p>
        </Section>
      </main>
    </div>
  );
}
