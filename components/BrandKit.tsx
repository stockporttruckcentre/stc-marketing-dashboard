'use client';

import { useMemo, useState } from 'react';
import { Image as ImageIcon, FileText, Upload, Plus, Trash2, Loader, Palette, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { BrandAsset, AssetType, UserRole } from '@/lib/types';

const ASSET_TYPES: AssetType[] = ['logo', 'font', 'color', 'template', 'image'];

export function BrandKit({
  initialAssets, role,
}: { initialAssets: BrandAsset[]; role: UserRole }) {
  const supabase = useMemo(() => createClient(), []);
  const [assets, setAssets] = useState<BrandAsset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [showAddColor, setShowAddColor] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = role === 'admin' || role === 'marketer';
  const categories = useMemo(() => {
    const set = new Set(assets.map(a => a.category));
    return Array.from(set).sort();
  }, [assets]);

  async function handleFileUpload(file: File, type: AssetType, category: string) {
    setUploading(true);
    setMessage(null);
    try {
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage
        .from('brand-assets').upload(fileName, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('brand-assets').getPublicUrl(fileName);
      const { data, error } = await supabase
        .from('brand_assets')
        .insert({ name: file.name, type, url: pub.publicUrl, category })
        .select('*').single();
      if (error) throw error;
      setAssets(a => [data as BrandAsset, ...a]);
      setMessage(`Uploaded ${file.name}`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function addColor(name: string, hex: string) {
    const { data, error } = await supabase
      .from('brand_assets')
      .insert({ name, type: 'color', url: hex, category: 'Colors' })
      .select('*').single();
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
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-auto">Brand Kit</h2>
        {canEdit && (
          <>
            <button onClick={() => setShowAddColor(s => !s)}
              className="px-4 py-2 border rounded-lg flex items-center gap-2 hover:bg-gray-50">
              <Palette size={14} /> Add color
            </button>
            <UploadMenu onUpload={handleFileUpload} uploading={uploading} />
          </>
        )}
      </div>

      {showAddColor && (
        <ColorForm onSubmit={addColor} onCancel={() => setShowAddColor(false)} />
      )}

      {message && <div className="bg-blue-50 text-blue-900 rounded-lg px-4 py-2 text-sm">{message}</div>}

      {categories.map(cat => (
        <div key={cat} className="bg-white rounded-lg shadow p-5">
          <h3 className="text-lg font-semibold mb-3">{cat}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {assets.filter(a => a.category === cat).map(asset => (
              <div key={asset.id} className="border rounded-lg p-3 hover:shadow-md transition-shadow group">
                <div className="h-24 rounded mb-2 flex items-center justify-center overflow-hidden">
                  {asset.type === 'color' ? (
                    <div className="w-full h-full rounded" style={{ backgroundColor: asset.url }} />
                  ) : asset.type === 'logo' || asset.type === 'image' || asset.type === 'template' ? (
                    /\.(png|jpe?g|webp|gif|svg)$/i.test(asset.url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.url} alt={asset.name} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <ImageIcon size={32} className="text-gray-300" />
                    )
                  ) : (
                    <FileText size={32} className="text-gray-300" />
                  )}
                </div>
                <p className="text-sm font-medium truncate">{asset.name}</p>
                {asset.type === 'color' && <p className="text-xs text-gray-600 font-mono">{asset.url}</p>}
                <div className="flex items-center justify-between mt-2">
                  {asset.type !== 'color' ? (
                    <a href={asset.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-stc-red hover:underline flex items-center gap-1">
                      <Download size={12} /> Download
                    </a>
                  ) : (
                    <span className="text-xs text-gray-500">{asset.url}</span>
                  )}
                  {canEdit && (
                    <button onClick={() => deleteAsset(asset)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {categories.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">No brand assets yet.</div>
      )}
    </div>
  );
}

function UploadMenu({
  onUpload, uploading,
}: { onUpload: (file: File, type: AssetType, cat: string) => void; uploading: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="px-4 py-2 bg-stc-red text-white rounded-lg hover:bg-stc-red-dark flex items-center gap-2">
        {uploading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
        Upload asset
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border rounded-lg shadow-lg z-20 p-2">
          {([
            ['Logo',     'logo',     'Logos'],
            ['Font',     'font',     'Fonts'],
            ['Template', 'template', 'Templates'],
            ['Image',    'image',    'Images'],
          ] as [string, AssetType, string][]).map(([label, type, cat]) => (
            <label key={type} className="block px-3 py-2 hover:bg-gray-50 rounded cursor-pointer text-sm">
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

function ColorForm({
  onSubmit, onCancel,
}: { onSubmit: (name: string, hex: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#071458');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name) onSubmit(name, hex); }}
      className="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-3"
    >
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Navy Primary" className="px-3 py-2 border rounded-lg" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Hex</label>
        <div className="flex items-center gap-2">
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} className="h-10 w-12 border rounded" />
          <input value={hex} onChange={(e) => setHex(e.target.value)} className="px-3 py-2 border rounded-lg font-mono w-28" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 border rounded-lg">Cancel</button>
        <button type="submit" className="px-4 py-2 bg-stc-navy text-white rounded-lg flex items-center gap-1">
          <Plus size={14} /> Add color
        </button>
      </div>
    </form>
  );
}
