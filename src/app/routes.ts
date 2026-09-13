import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("blogs", "routes/blogs.tsx"),
  route("blogs/:slug", "routes/blog-post.tsx"),
  route(":org/reports", "routes/reports.tsx"),
  route(":org/report/:slug", "routes/report.tsx"),
] satisfies RouteConfig;
