import { apiFetchAsViewer } from '@/lib/api-server';
import { fetchSettings } from '@/lib/settings';
import { Billboard, BillboardData } from '@/components/billboard';
import { Rail } from '@/components/rail';
import { TitleCard, TitleCardData } from '@/components/title-card';
import { ContinueWatchingRail } from '@/components/continue-watching-rail';

interface HomeRail {
  key: string;
  rail: string;
  titles: TitleCardData[];
}

interface HomePayload {
  billboard: (BillboardData & TitleCardData) | null;
  rails: HomeRail[];
}

export default async function HomePage() {
  let data: HomePayload = { billboard: null, rails: [] };
  try {
    data = await apiFetchAsViewer<HomePayload>('/home');
  } catch {
    // Backend not reachable (e.g. first local run before seeding) —
    // render an empty shell instead of crashing the page.
  }

  const settings = await fetchSettings();

  return (
    <main>
      {data.billboard && <Billboard data={data.billboard} fallbackArt={settings.heroBackgroundUrl} />}

      {!data.billboard && data.rails.length === 0 && (
        <p className="empty-state" style={{ paddingTop: 'calc(var(--header-h) + 40px)' }}>
          No content published yet — add titles via the admin panel.
        </p>
      )}

      <ContinueWatchingRail />

      {data.rails.map((rail) =>
        rail.key === 'top10' ? (
          <Rail key={rail.key} heading={rail.rail}>
            {rail.titles.map((t, i) => (
              <div className="top10-item" key={t.id}>
                <span className="top10-rank" aria-hidden>
                  {i + 1}
                </span>
                <TitleCard title={t} />
              </div>
            ))}
          </Rail>
        ) : (
          <Rail key={rail.key} heading={rail.rail}>
            {rail.titles.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </Rail>
        ),
      )}

      <div style={{ height: 60 }} />
    </main>
  );
}
