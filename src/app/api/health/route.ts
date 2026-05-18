export async function GET() {
  return Response.json({
    ok: true,
    service: 'swag-store-demo',
    checkedAt: new Date().toISOString(),
  });
}
