import { createContext, useContext, useEffect, useState, type ReactNode, type MouseEvent } from 'react';

/** Minimal history router — keeps the bundle lean and has zero dependencies. */
const Ctx = createContext<{ path: string; search: URLSearchParams; navigate: (to: string, replace?: boolean) => void }>({
  path: '/',
  search: new URLSearchParams(),
  navigate: () => {},
});

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = (to: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    const u = new URL(to, window.location.origin);
    setLoc({ path: u.pathname, search: u.search });
    if (!replace) window.scrollTo({ top: 0 });
  };
  return <Ctx.Provider value={{ path: loc.path, search: new URLSearchParams(loc.search), navigate }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, className, onClick, ...rest }: { to: string; children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      {...rest}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
