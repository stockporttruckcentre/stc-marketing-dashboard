'use client';

import { useEffect, useRef, useState } from 'react';
import { Svg, PencilIcon, CopyIcon, PeopleIcon, DownIcon, CrossIcon, BinIcon } from './icons';

/* =============================================================
   The role menu, as `docs/source/roles_hub/roles-role-menu.html`
   draws it. From that file's own opening comment:

     No repeating regions.
     Delete stays disabled while the role has holders, and states the
     count.

   ---- Why most of it is disabled ----

   The kit ships its own disabled row style, `r-9p`, on Delete, so
   showing an item that cannot be used is the design's own idea rather
   than a compromise here. Four of the six need a backend that does not
   exist: duplicating a role, exporting its definition and archiving it
   all write to `role_templates`, which today only the seed writes, and
   deleting is refused anyway while anybody holds the role.

   The two that work do work. Edit permissions opens the modal, and
   Assign people goes to the People tab of Admin, which is where
   putting somebody on a role actually happens.

   Each disabled row says why in its tooltip rather than looking broken.
   ============================================================= */

export type MenuItem = {
  key: string; label: string; icon: 'edit' | 'copy' | 'people' | 'export' | 'archive' | 'delete';
  danger?: boolean; disabled?: string | false; tail?: string; onPick?: () => void;
};

const ICON = {
  edit: <PencilIcon />, copy: <CopyIcon />, people: <PeopleIcon />,
  export: <DownIcon />, archive: <CrossIcon />, delete: <BinIcon />,
};

export function RoleMenu({ items, at, onClose }: {
  items: MenuItem[];
  /** Where the button that opened it is, in viewport coordinates. */
  at: { right: number; top: number };
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="roles-menu-scrim" onClick={onClose}>
      <div className="roles-menu" style={{ right: at.right, top: at.top }}
        onClick={(e) => e.stopPropagation()}>
        <div className="r-9m" ref={box} role="menu">
          {items.map((i) => (i.key === 'sep' ? <span key={i.key} className="r-9n"></span> : (
            <span key={i.key} role="menuitem"
              className={i.disabled ? 'r-9p' : i.danger ? 'r-9o' : 'r-3e'}
              title={i.disabled || undefined}
              onClick={i.disabled ? undefined : () => { i.onPick?.(); onClose(); }}>
              <Svg size={14}>{ICON[i.icon]}</Svg>{i.label}
              {i.tail && <><span className="r-k"></span><span className="r-9q">{i.tail}</span></>}
            </span>
          )))}
        </div>
      </div>
    </div>
  );
}

/** The six the kit draws, in its order, with what each one needs. */
export function menuFor({ role, holders, mayEdit, onEdit, onAssign }: {
  role: string; holders: number; mayEdit: boolean;
  onEdit: () => void; onAssign: () => void;
}): MenuItem[] {
  const noBackend = 'Not built yet: this writes to role_templates, which only the seed writes today';
  return [
    { key: 'edit', label: 'Edit permissions', icon: 'edit', onPick: onEdit,
      disabled: mayEdit ? false : 'Changing what a role can do needs the admin.roles permission' },
    { key: 'duplicate', label: 'Duplicate role', icon: 'copy', disabled: noBackend },
    { key: 'assign', label: 'Assign people', icon: 'people', onPick: onAssign },
    { key: 'export', label: 'Export definition', icon: 'export', disabled: noBackend },
    { key: 'sep', label: '', icon: 'edit' },
    { key: 'archive', label: 'Archive role', icon: 'archive', danger: true, disabled: noBackend },
    { key: 'delete', label: 'Delete role', icon: 'delete', danger: true,
      tail: holders > 0 ? `${holders} ${holders === 1 ? 'holder' : 'holders'}` : undefined,
      disabled: holders > 0
        ? `${role} cannot be deleted while ${holders === 1 ? 'somebody holds' : 'people hold'} it`
        : noBackend },
  ];
}
