import { Link } from "react-router";
import type { Route } from "./+types/blogs";
import { getBlogPosts } from "@/lib/content";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Blog — Arjun Aditya" }];
}

export default function Blogs() {
  const posts = getBlogPosts();

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-base font-medium text-neutral-900">Blog</h1>
      <p className="mt-1 text-sm text-neutral-500">
        General security thoughts and notes.
      </p>

      <ul className="mt-10 flex flex-col divide-y divide-neutral-200">
        {posts.map((p) => (
          <li key={p.slug} className="py-4">
            <Link to={`/blogs/${p.slug}`} className="group flex flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium text-neutral-900 group-hover:underline">
                  {p.title}
                </span>
                <span className="shrink-0 text-xs text-neutral-400">{p.date}</span>
              </span>
              <span className="text-sm text-neutral-500">{p.summary}</span>
            </Link>
          </li>
        ))}
        {posts.length === 0 && (
          <li className="py-4 text-sm text-neutral-500">No posts yet.</li>
        )}
      </ul>
    </div>
  );
}
