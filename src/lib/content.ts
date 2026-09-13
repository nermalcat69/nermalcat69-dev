export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  summary: string;
  content: string;
}

export interface Report {
  org: string;
  slug: string;
  title: string;
  date: string;
  summary: string;
  content: string;
}

const blogFiles = import.meta.glob("/src/content/blog/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const reportFiles = import.meta.glob("/src/content/reports/*/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function slugFromPath(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, content: match[2] };
}

const blogPosts: BlogPost[] = Object.entries(blogFiles)
  .map(([path, raw]) => {
    const { data, content } = parseFrontmatter(raw);
    return {
      slug: slugFromPath(path),
      title: data.title ?? slugFromPath(path),
      date: data.date ?? "",
      summary: data.summary ?? "",
      content,
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

const reports: Report[] = Object.entries(reportFiles)
  .map(([path, raw]) => {
    const parts = path.split("/");
    const org = parts[parts.length - 2];
    const { data, content } = parseFrontmatter(raw);
    return {
      org,
      slug: slugFromPath(path),
      title: data.title ?? slugFromPath(path),
      date: data.date ?? "",
      summary: data.summary ?? "",
      content,
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

export function getBlogPosts(): BlogPost[] {
  return blogPosts;
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getReports(org: string): Report[] {
  return reports.filter((r) => r.org === org);
}

export function getReport(org: string, slug: string): Report | undefined {
  return reports.find((r) => r.org === org && r.slug === slug);
}
