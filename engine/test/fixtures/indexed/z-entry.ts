interface Router {
  get(path: string, handler: () => void): void;
}

const session = { user: "" };

function onLogin(): void {
  session.user = "signed-in";
}

export function registerRoutes(router: Router): void {
  router.get("/login", onLogin);
}

export function readBody(request: { body: { user?: string } }): void {
  session.user = request.body.user ?? session.user;
}
