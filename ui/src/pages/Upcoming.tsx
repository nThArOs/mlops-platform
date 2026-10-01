import { Link } from "react-router-dom";

export default function Upcoming({ title }: { title: string }) {
  return (
    <div className="empty">
      <h1 className="title">{title}</h1>
      <p>This page doesn't exist.</p>
      <Link className="btn" to="/datasets">Go to datasets</Link>
    </div>
  );
}
