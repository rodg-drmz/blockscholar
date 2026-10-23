const views = new Set(['program', 'learn', 'mission', 'practice', 'work', 'fund']);

// Keep auth returns on this app and preserve the program step across reloads.
export function programReturnPath(view: string) {
  return views.has(view) && view !== 'program'
    ? `/learn/blockscholar?view=${view}`
    : '/learn/blockscholar';
}
