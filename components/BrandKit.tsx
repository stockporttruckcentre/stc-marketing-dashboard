'use client';

import { useMemo, useState } from 'react';
import { Image as ImageIcon, FileText, Upload, Plus, Trash2, Loader, Palette, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { BrandAsset, AssetType, UserRole } from '@/lib/types';

export function BrandKit({
  initialAssets, role,
}: { initialAssets: BrandAsset[]; role: UserRole }) {
  const supabase = useMemo(() => createClient(), []);
  const [assets, setAssets] = useState<BrandAsset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [showAddColor, setShowAddColor] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = role === 'admin' || role === 'marketer';

  // Logo display order — STC house first, then S&L, then divisions, then seasonal/no-oval last.
  // Matched against the file name in the public URL (case-insensitive).
  const LOGO_PRIORITY: string[] = [
    'stc-navy', 'stc-white',
    'sl-navy',  'sl-white',
    'group', 'holdings',
    'notext', 'trailerstogo', 'xmas', 'nooval',
  ];
  function logoRank(a: BrandAsset): number {
    const tail = (a.url || '').split('/').pop()?.toLowerCase() || '';
    const nameLower = (a.name || '').toLowerCase();
    for (let i = 0; i < LOGO_PRIORITY.length; i++) {
      if (tail.includes(LOGO_PRIORITY[i]) || nameLower.includes(LOGO_PRIORITY[i])) return i;
    }
    return LOGO_PRIORITY.length; // unranked goes last
  }
  const categories = useMemo(() => {
    const set = new Set(assets.map(a => a.category));
    return Array.from(set).sort();
  }, [assets]);

  async function handleFileUpload(file: File, type: AssetType, category: string) {
    setUploading(true); setMessage(null);
    try {
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('brand-assets').upload(fileName, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('brand-assets').getPublicUrl(fileName);
      const { data, error } = await supabase.from('brand_assets')
        .insert({ name: file.name, type, url: pub.publicUrl, category }).select('*').single();
      if (error) throw error;
      setAssets(a => [data as BrandAsset, ...a]);
      setMessage(`Uploaded ${file.name}`);
    } catch (e: any) {
      setMessage(e.message);
    } finally { setUploading(false); }
  }

  async function addColor(name: string, hex: string) {
    const { data, error } = await supabase.from('brand_assets')
      .insert({ name, type: 'color', url: hex, category: 'Colors' }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setAssets(a => [data as BrandAsset, ...a]);
    setShowAddColor(false);
  }

  async function deleteAsset(asset: BrandAsset) {
    if (!confirm(`Delete ${asset.name}?`)) return;
    if (asset.type !== 'color' && asset.url.includes('/storage/v1/object/public/brand-assets/')) {
      const path = asset.url.split('/brand-assets/').pop();
      if (path) await supabase.storage.from('brand-assets').remove([path]);
    }
    const { error } = await supabase.from('brand_assets').delete().eq('id', asset.id);
    if (error) { setMessage(error.message); return; }
    setAssets(a => a.filter(x => x.id !== asset.id));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Marketing · Brand kit</div>
          <h1 className="page-head__title"><ImageIcon size={26} style={{ color: 'var(--stc-red)' }} /><span>Brand assets<span style={{ color: 'var(--stc-red)' }}>.</span></span></h1>
          <div className="page-head__sub">Logos, fonts, templates and colours. Anyone can download; marketers can upload.</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__spacer" />
        {canEdit && (
          <>
            <button onClick={() => setShowAddColor(s => !s)} className="btn"><Palette size={14} /> Add colour</button>
            <UploadMenu onUpload={handleFileUpload} uploading={uploading} />
          </>
        )}
      </div>

      {showAddColor && <ColorForm onSubmit={addColor} onCancel={() => setShowAddColor(false)} />}
      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      {categories.map(cat => (
        <div key={cat} className="card" style={{ marginBottom: 14 }}>
          <div className="card__head"><h3 style={{ margin: 0 }}>{cat}</h3></div>
          <div style={{ padding: 18 }}>
            <div className="asset-grid">
              {assets
                .filter(a => a.category === cat)
                .sort((x, y) => {
                  if (cat.toLowerCase().includes('logo')) {
                    const r = logoRank(x) - logoRank(y);
                    if (r !== 0) return r;
                  }
                  return (x.name || '').localeCompare(y.name || '');
                })
                .map(asset => (
                <div key={asset.id} className="asset">
                  <div className="asset__preview">
                    {asset.type === 'color' ? (
                      <div style={{ width: '100%', height: '100%', background: asset.url, borderRadius: 'var(--r-2)' }} />
                    ) : asset.type === 'logo' || asset.type === 'image' || asset.type === 'template' ? (
                      /\.(png|jpe?g|webp|gif|svg)$/i.test(asset.url) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.url} alt={asset.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      ) : (
                        <ImageIcon size={28} style={{ color: 'var(--fg-4)' }} />
                      )
                    ) : (
                      <FileText size={28} style={{ color: 'var(--fg-4)' }} />
                    )}
                  </div>
                  <div className="asset__name">{asset.name}</div>
                  {asset.type === 'color' && <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{asset.url}</div>}
                  <div className="row" style={{ marginTop: 6, justifyContent: 'space-between' }}>
                    {asset.type !== 'color' ? (
                      <a href={asset.url} target="_blank" rel="noopener noreferrer" className="btn btn--sm btn--ghost"><Download size={12} /> Download</a>
                    ) : <span />}
                    {canEdit && (
                      <button onClick={() => deleteAsset(asset)} className="btn btn--icon btn--sm"><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
      {categories.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>No brand assets yet.</div>
      )}
    </div>
  );
}

function UploadMenu({ onUpload, uploading }: { onUpload: (f: File, t: AssetType, c: string) => void; uploading: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} className="btn btn--primary">
        {uploading ? <Loader size={14} className="spin" /> : <Upload size={14} />} Upload
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: '110%', width: 200, zIndex: 20, padding: 6 }}>
          {([['Logo','logo','Logos'],['Font','font','Fonts'],['Template','template','Templates'],['Image','image','Images']] as [string, AssetType, string][]).map(([label, type, cat]) => (
            <label key={type} style={{ display: 'block', padding: '8px 10px', cursor: 'pointer', fontSize: 12.5, color: 'var(--fg-2)', borderRadius: 'var(--r-2)' }}
              className="upload-opt">
              {label}
              <input type="file" hidden onChange={(e) => {
                const f = e.target.files?.[0]; if (f) { onUpload(f, type, cat); setOpen(false); }
                e.target.value = '';
              }} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorForm({ onSubmit, onCancel }: { onSubmit: (n: string, h: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#071458');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name) onSubmit(name, hex); }}
      className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
      <div className="field" style={{ flex: 1, minWidth: 180 }}>
        <div className="field__label">Name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Navy Primary" className="input" />
      </div>
      <div className="field">
        <div className="field__label">Hex</div>
        <div className="row" style={{ gap: 6 }}>
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} style={{ width: 40, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--r-2)', background: 'transparent' }} />
          <input value={hex} onChange={(e) => setHex(e.target.value)} className="input mono" style={{ width: 110 }} />
        </div>
      </div>
      <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
      <button type="submit" className="btn btn--primary"><Plus size={14} /> Add colour</button>
    </form>
  );
}
