(() => {
    let uvPfx = "/uv/";
    // Detect base path for GitHub Pages - check for /veltra in path
    let loc;
    
    if (self.location.pathname.includes(uvPfx)) {
        // Loaded from within /uv/ directory (service worker context)
        loc = self.location.pathname.substring(0, self.location.pathname.indexOf(uvPfx));
    } else if (self.location.pathname.includes('/veltra')) {
        // Loaded from GitHub Pages subdirectory (e.g., /veltra/app/uv.html)
        loc = '/veltra';
    } else {
        // Local development or root deployment
        loc = self.location.pathname.substring(0, self.location.pathname.lastIndexOf("/"));
        // If we're in a subdirectory like /app, go up one level
        if (loc.endsWith('/app')) {
            loc = loc.substring(0, loc.lastIndexOf('/'));
        }
    }

    self.__uv$config = {
        prefix: loc + uvPfx + "service/",
        encodeUrl: Ultraviolet.codec.xor.encode,
        decodeUrl: Ultraviolet.codec.xor.decode,
        handler: loc + uvPfx + "uv.handler.js",
        client: loc + uvPfx + "uv.client.js",
        bundle: loc + uvPfx + "uv.bundle.js",
        config: loc + uvPfx + "uv.config.js",
        sw: loc + uvPfx + "uv.sw.js",
        stockSW: loc + uvPfx + "sw.js",
        loc: loc,
    };
})();
