import { Link, useParams } from "react-router";
import type { Route } from "./+types/reports";
import { getReports } from "@/lib/content";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.org} reports — Arjun Aditya` }];
}

export default function Reports() {
  const { org } = useParams();
  const reports = getReports(org!);

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-base font-medium text-neutral-900">{org} / Reports</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Security checklists and common exploits.
      </p>

      <ul className="mt-10 flex flex-col divide-y divide-neutral-200">
        {reports.map((r) => (
          <li key={r.slug} className="py-4">
            <Link to={`/${org}/report/${r.slug}`} className="group flex flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium text-neutral-900 group-hover:underline">
                  {r.title}
                </span>
                <span className="shrink-0 text-xs text-neutral-400">{r.date}</span>
              </span>
              <span className="text-sm text-neutral-500">{r.summary}</span>
            </Link>
          </li>
        ))}
        {reports.length === 0 && (
          <li className="py-4 text-sm text-neutral-500">No reports for this org yet.</li>
        )}
      </ul>
    </div>
  );
}
