export function createRootRouteHandler({ spaIndexPath } = {}) {
    return function handleRootRoute(req, res, next) {
        if (!req?.session?.userId) {
            res.redirect('/login');
            return;
        }

        if (spaIndexPath) {
            res.sendFile(spaIndexPath, (err) => {
                if (err) {
                    next(err);
                }
            });
            return;
        }

        next();
    };
}
