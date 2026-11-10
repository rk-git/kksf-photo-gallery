import { useEffect, useMemo, useState } from 'react';

type Photo = { id: string; caption: string; uploadedAt: string; imageUrl: string; originalUrl: string; eventId?: string; eventTitle?: string };
type PhotoEvent = { id: string; title: string; eventDate: string; createdAt: string; photoCount: number; coverUrl: string; photos: Photo[] };
const API = import.meta.env.VITE_API_BASE || '';
const PUBLIC_BASE = import.meta.env.VITE_PUBLIC_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
const PHOTO_BASE = API || (typeof window !== 'undefined' ? window.location.origin : '');
async function makeDisplay(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file); const max = 1800; const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not process image'); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.84));
}
export default function App() {
  const adminMode = window.location.pathname.replace(/\/$/, '') === '/admin' || new URLSearchParams(window.location.search).get('admin') === '1';
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const monthOptions = Array.from({ length: 11 * 12 }, (_, index) => { const d = new Date(today.getFullYear() - 5, index, 1); return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }; });
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [events, setEvents] = useState<PhotoEvent[]>([]); const [photos, setPhotos] = useState<Photo[]>([]);
  const [files, setFiles] = useState<File[]>([]); const [eventTitle, setEventTitle] = useState(''); const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0,10)); const [eventSearch, setEventSearch] = useState(''); const [caption, setCaption] = useState('');
  const [password, setPassword] = useState(sessionStorage.getItem('inspire-admin') || ''); const [loggedIn, setLoggedIn] = useState(Boolean(sessionStorage.getItem('inspire-admin')));
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [tab, setTab] = useState<'gallery'|'upload'>(adminMode ? 'gallery' : 'gallery');
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null); const [selectedEvent, setSelectedEvent] = useState<PhotoEvent | null>(null); const [appendEventId, setAppendEventId] = useState(''); const [localPreviews, setLocalPreviews] = useState<string[]>([]); const [lastUploadedEvent, setLastUploadedEvent] = useState<{ id: string; title: string; count: number } | null>(null);
  const selectedNames = useMemo(() => files.map(f => f.name).join(', '), [files]);
  async function loadEvents() {
    try { const r = await fetch(`${API}/api/events`); if (r.ok) setEvents(await r.json()); else throw new Error(`Gallery request failed (${r.status})`); }
    catch { setMessage('Gallery API is not connected yet. Configure the Worker to load shared photos.'); }
  }
  async function loadPhotos() { try { const r = await fetch(`${API}/api/photos`); if (r.ok) setPhotos(await r.json()); } catch { /* event endpoint reports connection state */ } }
  useEffect(() => { void loadEvents(); void loadPhotos(); }, []);
  // Shared event links open the frontend route, not the Worker API origin.
  useEffect(() => {
    const match = window.location.pathname.match(/^\/e\/([a-zA-Z0-9]+)\/?$/);
    if (match && events.length) {
      const event = events.find(item => item.id === match[1]);
      if (event) setSelectedEvent(event);
    }
  }, [events]);
  useEffect(() => { const urls = files.map(f => URL.createObjectURL(f)); setLocalPreviews(urls); return () => urls.forEach(URL.revokeObjectURL); }, [files]);

async function signIn() {
  if (!password.trim()) {
    setMessage('Please enter the administrator password.');
    return;
  }

  setBusy(true);
  setMessage('');

  try {
    const response = await fetch(`${API}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      setMessage('Incorrect administrator password. Please try again.');
      return;
    }

    sessionStorage.setItem('inspire-admin', password);
    setLoggedIn(true);
    setMessage('Administrator authenticated successfully.');
  } catch {
    setMessage('Unable to contact the authentication service.');
  } finally {
    setBusy(false);
  }
}
  function signOut() { sessionStorage.removeItem('inspire-admin'); setLoggedIn(false); setPassword(''); }
  async function upload() {
    const existingEvent = events.find(event => event.id === appendEventId);
    if (!existingEvent && !eventTitle.trim()) { setMessage('Enter an event name before uploading.'); return; }
    if (!files.length) { setMessage('Choose at least one photo.'); return; }
    if (!loggedIn) { setMessage('Sign in as an administrator first.'); return; }
    setBusy(true); setMessage(''); let successes = 0; const eventId = existingEvent?.id || crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    const uploadTitle = existingEvent?.title || eventTitle.trim();
    const uploadDate = existingEvent?.eventDate || eventDate;
    try {
      for (const file of files) {
        const display = await makeDisplay(file); const form = new FormData();
        form.append('original', file, file.name); form.append('display', display, 'display.jpg'); form.append('caption', caption); form.append('eventId', eventId); form.append('eventTitle', uploadTitle); form.append('eventDate', uploadDate);
        const response = await fetch(`${API}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${password}` }, body: form });
        if (!response.ok) throw new Error(await response.text() || `Upload failed (${response.status})`); successes++;
      }
      setMessage(`${successes} photo(s) added to “${uploadTitle}”.`); setLastUploadedEvent({ id: eventId, title: uploadTitle, count: successes }); setFiles([]); setCaption(''); setEventTitle(''); setAppendEventId(''); setEventDate(new Date().toISOString().slice(0,10)); await loadEvents(); await loadPhotos(); setTab('upload'); setSelectedEvent(null);
    } catch (e) { setMessage(`Upload stopped after ${successes} successful photo(s): ${e instanceof Error ? e.message : 'Unknown error'}`); }
    finally { setBusy(false); }
  }
  async function copyLink(id: string) { await navigator.clipboard.writeText(`${PHOTO_BASE}/p/${id}`); setMessage('Photo link copied. Paste it into WhatsApp.'); }
  async function deletePhoto(photo: Photo) {
    if (!loggedIn || !adminMode) return;
    if (!window.confirm(`Permanently delete this photograph? This cannot be undone.`)) return;

    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(`${API}/api/photos/${photo.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${password}` },
      });

      if (!response.ok) {
        throw new Error(await response.text() || `Deletion failed (${response.status})`);
      }

      if (lightboxPhoto?.id === photo.id) setLightboxPhoto(null);

      const refreshed = await fetch(`${API}/api/events`);
      if (!refreshed.ok) throw new Error(`Gallery refresh failed (${refreshed.status})`);

      const updatedEvents: PhotoEvent[] = await refreshed.json();
      setEvents(updatedEvents);
      const updatedPhotos = await fetch(`${API}/api/photos`);
      if (updatedPhotos.ok) setPhotos(await updatedPhotos.json());

      if (selectedEvent) {
        const updatedEvent = updatedEvents.find(event => event.id === selectedEvent.id);
        setSelectedEvent(updatedEvent || null);
      }

      setMessage('Photograph deleted successfully.');
    } catch (error) {
      setMessage(`Could not delete photograph: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  }
  async function copyEventLink(id: string) { await navigator.clipboard.writeText(`${PUBLIC_BASE}/e/${id}`); setMessage('Event link copied. Paste it into WhatsApp.'); }
  function shareWhatsApp(photo: Photo) { const link = `${PHOTO_BASE}/p/${photo.id}`; window.open(`https://wa.me/?text=${encodeURIComponent(`${photo.caption ? photo.caption + '\n\n' : ''}${link}`)}`, '_blank', 'noopener,noreferrer'); }
  function shareEvent(event: PhotoEvent) { const link = `${PUBLIC_BASE}/e/${event.id}`; window.open(`https://wa.me/?text=${encodeURIComponent(`${event.title}\n${link}`)}`, '_blank', 'noopener,noreferrer'); }
  const activeEvent = selectedEvent ? events.find(e => e.id === selectedEvent.id) || selectedEvent : null;
  const lightboxIndex = activeEvent && lightboxPhoto
    ? activeEvent.photos.findIndex(photo => photo.id === lightboxPhoto.id)
    : -1;
  function moveLightbox(direction: -1 | 1) {
    if (!activeEvent || lightboxIndex < 0) return;
    const nextIndex = lightboxIndex + direction;
    if (nextIndex >= 0 && nextIndex < activeEvent.photos.length) {
      setLightboxPhoto(activeEvent.photos[nextIndex]);
    }
  }
  useEffect(() => {
    if (!lightboxPhoto) return;
    function handleLightboxKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setLightboxPhoto(null);
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setLightboxPhoto(current => {
          if (!current || !activeEvent) return current;
          const index = activeEvent.photos.findIndex(photo => photo.id === current.id);
          return index > 0 ? activeEvent.photos[index - 1] : current;
        });
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setLightboxPhoto(current => {
          if (!current || !activeEvent) return current;
          const index = activeEvent.photos.findIndex(photo => photo.id === current.id);
          return index >= 0 && index < activeEvent.photos.length - 1
            ? activeEvent.photos[index + 1]
            : current;
        });
      }
    }
    window.addEventListener('keydown', handleLightboxKey);
    return () => window.removeEventListener('keydown', handleLightboxKey);
  }, [lightboxPhoto, activeEvent]);
  return <main className="shell">
    <header className="site-header"><div className="brand-lockup"><img className="brand-mark" src="https://kksfusa.org/favicon.ico" alt="KKSF logo" onError={e=>{e.currentTarget.style.display='none';}}/><div className="brand-copy"><h1>Kanchi Mutt Photo Gallery</h1><p>Gallery of KKSF events</p></div></div></header>
    <div className="banner-frame"><img className="community-banner" src="/kanchi-mutt-banner.jpeg" alt="Kanchi Mutt spiritual teachers and devotional imagery" /></div>
       {adminMode && !loggedIn ? (
      <section className="admin-login-gateway">
        <div className="admin-login-card">
          <span className="eyebrow">KANCHI MUTT PHOTO GALLERY</span>
          <h2>Administrator Login</h2>
          <p>Sign in to manage community event photographs.</p>
          <label>
            Administrator password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter administrator password"
              onKeyDown={e => {
                if (e.key === 'Enter') void signIn();
              }}
              autoFocus
            />
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void signIn()}
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          {message && <p className="login-error" role="alert">{message}</p>}
        </div>
      </section>
    ) : (
      <>
    {adminMode && <nav><button className={tab==='gallery'?'active':''} onClick={()=>{setTab('gallery');setSelectedEvent(null);}}>Events gallery</button><button className={tab==='upload'?'active':''} onClick={()=>{setTab('upload');setSelectedEvent(null);}}>Upload photos</button></nav>}
    {message && <div className="notice" role="status">{message}<button onClick={()=>setMessage('')} aria-label="Dismiss">×</button></div>}
    {tab === 'upload' && lastUploadedEvent && <section className="upload-success panel" role="status"><span className="eyebrow">UPLOAD COMPLETE</span><h2>{lastUploadedEvent.title}</h2><p>{lastUploadedEvent.count} photograph(s) were successfully added to this event.</p><div className="event-share-url">{`${PUBLIC_BASE}/e/${lastUploadedEvent.id}`}</div><div className="actions"><button className="primary" onClick={()=>void copyEventLink(lastUploadedEvent.id)}>Copy event link</button><button className="quiet" onClick={()=>{const event=events.find(e=>e.id===lastUploadedEvent.id); if(event){setSelectedEvent(event);setTab('gallery');}}}>View event</button></div></section>}
    {tab === 'upload' ? <section className="panel"><div className="section-heading"><div><span className="eyebrow">CONTRIBUTOR AREA</span><h2>Add photographs</h2><p>Create a new event or add photographs to an existing event. Existing event links remain unchanged.</p></div></div>

<div className="signed-in">
  <span>✓ Administrator session active</span>
  <button className="quiet" onClick={signOut}>Sign out</button>
</div>
      <label className="caption-label event-title-label">Add to existing event<select value={appendEventId} onChange={e=>setAppendEventId(e.target.value)}><option value="">Create a new event instead</option>{events.map(event=><option key={event.id} value={event.id}>{event.title} ({event.eventDate})</option>)}</select></label>{!appendEventId && <label className="caption-label event-title-label">Event name<input value={eventTitle} onChange={e=>setEventTitle(e.target.value)} placeholder="e.g. Rudrabhishekam - Fremont" /></label>}{!appendEventId && <label className="caption-label event-title-label">Event date<input type="date" value={eventDate} onChange={e=>setEventDate(e.target.value)} /></label>}
      <label className="dropzone"><input type="file" accept="image/*" multiple onChange={e=>setFiles(Array.from(e.target.files || []))}/><span className="plus">＋</span><strong>Select photographs</strong><span>Choose multiple images from your device</span></label>
      {files.length>0 && <><p className="file-summary">{files.length} selected: {selectedNames}</p><div className="preview-row">{localPreviews.map((url,i)=><img key={url} src={url} alt={`Selected photo ${i+1}`}/>)}</div><label className="caption-label">Caption (optional, applies to all selected photos)<textarea value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Add a description or leave blank" rows={3}/></label><button className="primary upload-button" disabled={busy || !loggedIn} onClick={()=>void upload()}>{busy?'Uploading…':'Upload event photographs'}</button></>}
    </section> : <section className="gallery-content">
      {activeEvent ? <><button className="back-button" onClick={()=>{
        setSelectedEvent(null);
        if(window.location.pathname.startsWith('/e/')) {
          window.history.pushState({}, '', adminMode ? '/admin' : '/');
        }
      }}>← All events</button><div className="section-heading gallery-heading"><div><span className="eyebrow">EVENT ALBUM</span><h2>{activeEvent.title}</h2>
        <p>{new Date(`${activeEvent.eventDate}T12:00:00`).toLocaleDateString()} · {activeEvent.photos.length} photographs</p>
      </div><button className="quiet" onClick={()=>shareEvent(activeEvent)}>Share event on WhatsApp</button></div>
        <div className="grid">{activeEvent.photos.map(photo=><article className="card" key={photo.id}><button className="photo-preview-button" onClick={()=>setLightboxPhoto(photo)} aria-label={`View ${photo.caption || activeEvent.title}`}><img src={photo.imageUrl} alt={photo.caption || activeEvent.title}/></button><div className="card-body"><p>{photo.caption || activeEvent.title}</p>
<div className="actions"><button onClick={()=>void copyLink(photo.id)}>Copy link</button><button onClick={()=>shareWhatsApp(photo)}>WhatsApp</button>{adminMode && loggedIn && <button className="delete-photo" disabled={busy} onClick={()=>void deletePhoto(photo)}>Delete</button>}</div></div></article>)}</div>
      </> : <><div className="section-heading gallery-heading"><div><span className="eyebrow">THE COMMUNITY COLLECTION</span><h2>Events</h2><p>Select an event to view its photographs.</p></div><span className="count">{events.length} events · {photos.length} photos</span></div>
        <div className="event-tools"><label className="month-picker"><span>Choose a month</span><select aria-label="Choose a month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}>{monthOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="event-search"><span>Find an event</span><input type="search" value={eventSearch} onChange={e=>setEventSearch(e.target.value)} placeholder="Search event name or location…" /></label></div>{(() => { const filtered = events.filter(event => event.eventDate.slice(0,7) === selectedMonth && `${event.title} ${event.eventDate}`.toLowerCase().includes(eventSearch.toLowerCase())).sort((a,b)=>b.eventDate.localeCompare(a.eventDate)); return filtered.length ? <div className="event-grid">{filtered.map(event=><button className="event-card" key={event.id} onClick={()=>{
          setSelectedEvent(event);
          window.history.pushState({}, '', `/e/${event.id}${adminMode ? '?admin=1' : ''}`);
        }}><img src={event.coverUrl} alt=""/><span className="event-card-body"><strong>{event.title}</strong><small>{new Date(`${event.eventDate}T12:00:00`).toLocaleDateString()} · {event.photoCount} photographs</small><span className="event-open">View photographs →</span></span></button>)}</div> : <div className="empty"><h3>No events for this month</h3><p>Choose another month or change your search.</p></div>; })()}
      </>}
    </section>}
          </>
    )}
    {lightboxPhoto && <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={()=>setLightboxPhoto(null)}>
      <button className="lightbox-close" type="button" aria-label="Close photo" onClick={()=>setLightboxPhoto(null)}>×</button>
      <button className="lightbox-nav lightbox-prev" type="button" aria-label="Previous photograph" disabled={lightboxIndex <= 0} onClick={event=>{event.stopPropagation();moveLightbox(-1);}}>‹</button>
      <div className="lightbox-frame" onClick={event=>event.stopPropagation()}>
        <img src={lightboxPhoto.originalUrl || lightboxPhoto.imageUrl} alt={lightboxPhoto.caption || 'Event photograph'}/>
      </div>
      <button className="lightbox-nav lightbox-next" type="button" aria-label="Next photograph" disabled={!activeEvent || lightboxIndex >= activeEvent.photos.length - 1} onClick={event=>{event.stopPropagation();moveLightbox(1);}}>›</button>
      <span className="lightbox-caption">{lightboxPhoto.caption || activeEvent?.title || 'Event photograph'} · {lightboxIndex + 1} of {activeEvent?.photos.length || 1} · Use ← → to navigate · Esc to close</span>
    </div>}
    <footer>Copyright (c) 2026 Always Up Networks LLC - all rights reserved</footer>
  </main>;
}
