export default function NotFound() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#121212", color: "#E0E0E0", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "48px", fontWeight: 200, margin: 0 }}>404</h1>
        <p style={{ color: "#888", marginTop: "8px" }}>Page not found</p>
        <a href="/" style={{ color: "#60a5fa", textDecoration: "none", fontSize: "14px" }}>Go to Sofi IDE</a>
      </div>
    </div>
  );
}
