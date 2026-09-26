export function allowedHosts(port = Number(process.env.PORT || 4177)) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}
export function isLoopback(req) {
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress || '');
}
export function guardRequest(req,res,{port=Number(process.env.PORT||4177),extensionId=process.env.SHINO_CONTROL_EXTENSION_ID||''}={}) {
  const host=req.headers.host || '';
  const origin=req.headers.origin;
  const validOrigin=origin === undefined || origin === `http://${host}` || (extensionId && origin === `chrome-extension://${extensionId}`);
  const site=req.headers['sec-fetch-site'];
  const fetchMode=req.headers['sec-fetch-mode'];
  const fetchDest=req.headers['sec-fetch-dest'];
  // Extension service workers fetch CONTROL with Origin: chrome-extension://<id>.
  // An extension cannot be preapproved safely until its installed ID is known.
  // Same-origin dashboard requests and native Windows clients remain supported.
  if (!isLoopback(req) || !allowedHosts(port).has(host) || !validOrigin || (site && !['same-origin','none'].includes(site) && !(extensionId && origin===`chrome-extension://${extensionId}`))) {
    res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    res.end('Forbidden');
    return false;
  }
  if (['POST','PUT','PATCH','DELETE'].includes(req.method) && origin === undefined) {
    if (fetchMode === 'navigate' || (fetchDest && fetchDest !== 'empty')) {
      res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      res.end('Forbidden');
      return false;
    }
    const type=String(req.headers['content-type']||'').split(';',1)[0].trim().toLowerCase();
    if (['application/x-www-form-urlencoded','multipart/form-data','text/plain'].includes(type)) {
      res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      res.end('Forbidden');
      return false;
    }
  }
  return true;
}
export function json(res,code,body) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
}
