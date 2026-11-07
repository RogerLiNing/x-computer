/** A present but unrecognized value must not resume background work after a restart. */
export function backgroundAutostartEnabled():boolean {
  const value=process.env.X_COMPUTER_BACKGROUND_AUTOSTART;
  return value===undefined||value==='true';
}
