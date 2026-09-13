import { marked } from "marked";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/report";
import { getReport } from "@/lib/content";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.slug} — ${params.org} reports` }];
}

export default function Report() {
  const { org, slug } = useParams();
  const report = getReport(org!, slug!);

  if (!report) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16 text-sm text-neutral-700">
        <p>Report not found.</p>
        <Link
          to={`/${org}/reports`}
          className="mt-2 inline-block text-neutral-500 underline hover:text-neutral-900"
        >
          Back to reports
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <Link
        to={`/${org}/reports`}
        className="text-sm text-neutral-500 underline hover:text-neutral-900"
      >
        ← {org} / Reports
      </Link>
      <h1 className="mt-4 text-lg font-medium text-neutral-900">{report.title}</h1>
      <p className="mt-1 text-xs text-neutral-400">{report.date}</p>
      <div
        className="prose prose-neutral prose-sm mt-8 max-w-none"
        dangerouslySetInnerHTML={{ __html: marked.parse(report.content) as string }}
      />
    </div>
  );
}
