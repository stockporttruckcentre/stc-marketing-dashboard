/* =============================================================
   Every column of every table, so nothing is unreachable.

   The curated dictionary in fields.ts is written by hand, because a
   column called `refurb_costs_at_sale` is called "refurb at sale" by the
   people who use it and no amount of string manipulation gets there.
   Hand writing is right for the columns people talk about.

   It is wrong as the only mechanism. Hand writing means the dictionary
   covers whatever somebody remembered, which is exactly how the bar
   ended up with no social posts in it at all. A column nobody wrote an
   alias for was a column nobody could reach, and there was no way to
   tell which ones those were.

   So this is the whole schema, read out of supabase/schema.sql and the
   migrations. fields.ts curates what it curates and then generates an
   entry for everything left over, with aliases derived from the column
   name. The derived words are worse than the hand written ones. They are
   infinitely better than nothing, and the completeness check can now ask
   a question it could not ask before: is there a column in this database
   that the command bar cannot write?

   Add a column, add it here. The check fails otherwise.
   ============================================================= */

export type ColumnKind = 'money' | 'number' | 'text' | 'longtext' | 'date' | 'enum' | 'bool' | 'system';

export type ColumnSpec = {
  name: string;
  kind: ColumnKind;
  /** Permitted values, where the column has a CHECK constraint. */
  values?: string[];
  /**
   * Ids, timestamps and derived numbers. Listed so the completeness
   * check can see they were considered, and skipped so nobody types at
   * a total that is the sum of two other columns.
   */
  writable?: false;
  /** Why it is not writable, when that is not obvious. */
  why?: string;
};

/**
 * What it takes to make one of these rows, or get rid of one.
 *
 * DECLARED PER TABLE, BECAUSE IT IS A PROPERTY OF THE OPERATION.
 *
 * The lifecycle readers used to derive it from the writable dictionary
 * entry for whichever column identifies the record, which for a contact
 * is `company_name` and therefore `crm.edit`. `lib/crm/permissions.ts`
 * distinguishes `crm.edit` from `crm.delete` deliberately, and deriving
 * one from the other meant a marketer, who may edit every field on a
 * customer and delete nothing, could have a deletion represented and
 * permitted.
 *
 * The values are the ones the manual routes and the row policies
 * already use, so the command bar asks for exactly what the screen asks
 * for. A table with nothing here cannot be created or deleted from a
 * sentence at all, which is the safe way round.
 */
export type LifecyclePermissions = {
  create?: string;
  delete?: string;
  /**
   * What it takes to hang a file off one of these rows.
   *
   * A property of the target, not of attaching: a condition report goes
   * on a trailer under `stock.edit` and a signed proposal goes on a
   * customer under `crm.edit`, and somebody may hold one and not the
   * other. Migration 014 already derived it this way; declaring it here
   * is what lets the planner give the same answer.
   */
  attach?: string;
};

export type TableSpec = {
  table: string;
  /** What the rows are, in the words people use. */
  label: string;
  columns: ColumnSpec[];
  /** What it takes to make one of these or get rid of one. */
  lifecycle?: LifecyclePermissions;
};

const SYSTEM: ColumnSpec[] = [
  { name: 'id', kind: 'system', writable: false, why: 'identifier' },
  { name: 'created_at', kind: 'system', writable: false, why: 'set on insert' },
  { name: 'updated_at', kind: 'system', writable: false, why: 'set by a trigger' },
];

export const TABLES: TableSpec[] = [
  {
    table: 'crm_contacts', label: 'customers',
    lifecycle: { create: 'crm.create', delete: 'crm.delete', attach: 'crm.edit' },
    columns: [
      ...SYSTEM,
      { name: 'company_name', kind: 'text' },
      { name: 'contact_name', kind: 'text' },
      { name: 'email', kind: 'text' },
      { name: 'phone', kind: 'text' },
      { name: 'source', kind: 'text' },
      { name: 'status', kind: 'enum', values: ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'],
        writable: false, why: 'derived from the state of the account\'s leads, migration 043' },
      { name: 'fleet_size', kind: 'number', writable: false, why: 'derived from trucks, trailers and vans by a trigger' },
      { name: 'location', kind: 'text' },
      { name: 'services_interested', kind: 'text' },
      { name: 'notes', kind: 'longtext' },
      { name: 'assigned_to', kind: 'text' },
      { name: 'last_contact', kind: 'date' },
      { name: 'list_id', kind: 'system', writable: false, why: 'moved with the move to list action, not typed' },
      { name: 'trucks', kind: 'number' },
      { name: 'trailers', kind: 'number' },
      { name: 'vans', kind: 'number' },
      { name: 'address', kind: 'text' },
      { name: 'links', kind: 'system', writable: false, why: 'a list of links, edited one at a time' },
      { name: 'employee_count', kind: 'number' },
      { name: 'turnover', kind: 'money' },
      { name: 'description', kind: 'longtext' },
      { name: 'account_manager', kind: 'text' },
      { name: 'category', kind: 'text' },
      { name: 'vehicles', kind: 'text' },
      { name: 'last_activity_at', kind: 'system', writable: false, why: 'set by a trigger on notes and status changes' },
      { name: 'parent_customer_id', kind: 'system', writable: false, why: 'set by linking two accounts' },
      { name: 'relationship', kind: 'enum', values: ['prospect', 'existing'] },
    ],
  },
  {
    /*
       A pitch, which is not something a company has.

       Everything below used to be a column on `crm_contacts`, and the
       comment two files over said the quiet part: "deals and contacts
       are two readings of crm_contacts". They are two tables now, so
       "add £1k refurb value to STC143980" reaches a deal and "add their
       phone number" reaches a company, and neither can land on the
       other by accident.
    */
    table: 'crm_leads', label: 'leads',
    lifecycle: { create: 'crm.create', delete: 'crm.delete', attach: 'crm.edit' },
    columns: [
      ...SYSTEM,
      { name: 'contact_id', kind: 'system', writable: false, why: 'the customer it is a pitch to, set when the lead is raised' },
      { name: 'owner_id', kind: 'system', writable: false, why: 'whose tracker it is on, set when the lead is raised or handed over' },
      { name: 'shared_with', kind: 'system', writable: false, why: 'who else is working it, changed by sharing rather than typing' },
      { name: 'type', kind: 'enum', values: ['trailer_sales', 'maintenance', 'rental'] },
      { name: 'status', kind: 'enum', values: ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'] },
      { name: 'what', kind: 'text' },
      { name: 'requirement', kind: 'longtext' },
      { name: 'new_or_used', kind: 'enum', values: ['New', 'Used'] },
      { name: 'estimated_value', kind: 'money' },
      { name: 'date_of_enquiry', kind: 'date' },
      { name: 'action', kind: 'text' },
      { name: 'next_action', kind: 'text' },
      { name: 'last_activity_at', kind: 'system', writable: false, why: 'set when the lead moves' },
      { name: 'stock_trailer_id', kind: 'system', writable: false, why: 'set by linking a trailer to the deal' },
      { name: 'order_date', kind: 'date' },
      { name: 'dispatch_date', kind: 'date' },
      { name: 'sale_price', kind: 'money' },
      { name: 'profit', kind: 'money' },
      { name: 'profit_pct', kind: 'number' },
      { name: 'commission', kind: 'money' },
      { name: 'commission_rate', kind: 'number' },
      { name: 'rep_initials', kind: 'text' },
      { name: 'notes', kind: 'longtext' },
      { name: 'company_name', kind: 'text', writable: false, why: 'the customer\'s name, kept in step with the account by a trigger' },
      { name: 'created_by', kind: 'system', writable: false, why: 'who raised it' },
    ],
  },
  {
    table: 'stock_trailers', label: 'trailers',
    lifecycle: { create: 'stock.edit', delete: 'stock.edit', attach: 'stock.edit' },
    columns: [
      ...SYSTEM,
      { name: 'status', kind: 'enum', values: ['new_build', 'in_stock', 'sales_order', 'sold', 'rental', 'scrap'] },
      { name: 'category', kind: 'enum' },
      { name: 'stc_no', kind: 'text' },
      { name: 'supplier', kind: 'text' },
      { name: 'trade_in', kind: 'bool' },
      { name: 'chassis_number', kind: 'text' },
      { name: 'ministry_no', kind: 'text' },
      { name: 'supplier_no', kind: 'text' },
      { name: 'received_date', kind: 'date' },
      { name: 'paid_status', kind: 'text' },
      { name: 'year', kind: 'number' },
      { name: 'make', kind: 'text' },
      { name: 'model', kind: 'text' },
      { name: 'side_aperture', kind: 'text' },
      { name: 'colour', kind: 'text' },
      { name: 'description', kind: 'longtext' },
      { name: 'door_type', kind: 'text' },
      { name: 'mot_date', kind: 'date' },
      { name: 'axle_type', kind: 'text' },
      { name: 'location', kind: 'text' },
      { name: 'status_text', kind: 'text' },
      { name: 'sales_rep', kind: 'text' },
      { name: 'nbv', kind: 'money' },
      { name: 'refurb_costs', kind: 'money' },
      { name: 'refurb_costs_at_sale', kind: 'money' },
      { name: 'total_nbv', kind: 'money', writable: false, why: 'the sum of book value and the two refurb columns' },
      { name: 'new_or_used', kind: 'enum', values: ['New', 'Used'] },
      { name: 'customer', kind: 'text' },
      { name: 'order_date', kind: 'date' },
      { name: 'dispatch_date', kind: 'date' },
      { name: 'month', kind: 'date' },
      { name: 'sales_price', kind: 'money' },
      { name: 'profit', kind: 'money', writable: false, why: 'sale price less total book value' },
      { name: 'profit_pct', kind: 'number', writable: false, why: 'derived from profit' },
      { name: 'trailer_docs', kind: 'text' },
      { name: 'signed_order', kind: 'enum', values: ['Yes', 'No'] },
      { name: 'deposit_received', kind: 'enum', values: ['Yes', 'No'] },
      { name: 'paid_in_full', kind: 'enum', values: ['Yes', 'No'] },
      { name: 'refurb_update', kind: 'longtext' },
      { name: 'refurb_done', kind: 'longtext' },
      { name: 'tread_depths', kind: 'text' },
      { name: 'chassis_colour', kind: 'text' },
      { name: 'body_colour', kind: 'text' },
      { name: 'expected_delivery', kind: 'date' },
      { name: 'retail_price', kind: 'money' },
      { name: 'sold_price', kind: 'money' },
      { name: 'quote_no', kind: 'text' },
      { name: 'hyperlink', kind: 'text' },
      { name: 'notes', kind: 'longtext' },
      { name: 'jr_notes', kind: 'longtext' },
      { name: 'comments', kind: 'longtext' },
      { name: 'documents', kind: 'text' },
      { name: 'fleet_serve_link', kind: 'text' },
    ],
  },
  {
    table: 'social_posts', label: 'social posts',
    /* No generic create. A post's author is not writable and the column
       is NOT NULL, so an insert built out of writable columns alone
       cannot be accepted by the database. Writing one is `post.create`,
       which fills the author and the status in from the profile the way
       the composer does. Deleting one is still ordinary. */
    lifecycle: { delete: 'marketing.edit' },
    columns: [
      ...SYSTEM,
      { name: 'content', kind: 'longtext' },
      { name: 'platform', kind: 'enum', values: ['facebook', 'instagram', 'linkedin', 'x'] },
      { name: 'scheduled_date', kind: 'date' },
      { name: 'status', kind: 'enum', values: ['draft', 'pending_review', 'approved', 'scheduled', 'posted'] },
      { name: 'created_by', kind: 'text', writable: false, why: 'whoever wrote it' },
      { name: 'reviewed_by', kind: 'text' },
      { name: 'image_url', kind: 'text' },
      { name: 'caption', kind: 'longtext' },
      { name: 'hashtags', kind: 'text' },
    ],
  },
  {
    table: 'calendar_events', label: 'meetings',
    /* Booking a meeting and cancelling one are both `crm.delegate`,
       which is what the calendar screen and every writable column on
       this table already gate on. It was `crm.edit`, so a marketer who
       may not book a meeting could cancel one. */
    lifecycle: { create: 'crm.delegate', delete: 'crm.delegate' },
    columns: [
      ...SYSTEM,
      { name: 'title', kind: 'text' },
      { name: 'description', kind: 'longtext' },
      { name: 'start_at', kind: 'date' },
      { name: 'end_at', kind: 'date' },
      { name: 'all_day', kind: 'bool' },
      { name: 'color', kind: 'text' },
      { name: 'created_by', kind: 'system', writable: false, why: 'whoever booked it' },
      { name: 'contact_id', kind: 'system', writable: false, why: 'set by booking against a customer' },
      { name: 'attendees', kind: 'system', writable: false, why: 'managed by inviting and uninviting' },
      { name: 'visibility', kind: 'enum', values: ['private', 'team', 'specific'] },
      { name: 'visible_to', kind: 'system', writable: false, why: 'managed by sharing' },
    ],
  },
  {
    table: 'calendar_invites', label: 'invitations',
    columns: [
      ...SYSTEM,
      { name: 'event_id', kind: 'system', writable: false, why: 'which meeting' },
      { name: 'user_id', kind: 'system', writable: false, why: 'who was asked' },
      { name: 'invited_by', kind: 'system', writable: false, why: 'who asked them' },
      { name: 'status', kind: 'enum', values: ['pending', 'accepted', 'declined', 'proposed'], writable: false,
        why: 'changed by accepting, declining or proposing, never set directly' },
      { name: 'proposed_start_at', kind: 'date', writable: false, why: 'set by proposing a time' },
      { name: 'proposed_end_at', kind: 'date', writable: false, why: 'set by proposing a time' },
      { name: 'awaiting', kind: 'system', writable: false, why: 'derived from whose turn it is' },
      { name: 'rounds', kind: 'number', writable: false, why: 'counted' },
      { name: 'note', kind: 'longtext' },
      { name: 'responded_at', kind: 'system', writable: false, why: 'stamped on answering' },
    ],
  },
  {
    table: 'contact_addresses', label: 'addresses',
    lifecycle: { create: 'crm.edit', delete: 'crm.edit' },
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on insert' },
      { name: 'contact_id', kind: 'system', writable: false, why: 'which customer' },
      { name: 'label', kind: 'text' },
      { name: 'address', kind: 'longtext' },
      { name: 'city', kind: 'text' },
      { name: 'is_primary', kind: 'bool' },
      { name: 'lat', kind: 'number', writable: false, why: 'placed on the map, not typed' },
      { name: 'lng', kind: 'number', writable: false, why: 'placed on the map, not typed' },
      { name: 'geo_source', kind: 'enum', values: ['geocoded', 'manual'], writable: false, why: 'recorded by the map' },
      { name: 'geo_updated_at', kind: 'system', writable: false, why: 'stamped by the map' },
    ],
  },
  {
    table: 'contact_notes', label: 'notes',
    lifecycle: { create: 'crm.edit', delete: 'crm.edit' },
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on insert' },
      { name: 'contact_id', kind: 'system', writable: false, why: 'which customer' },
      { name: 'author_id', kind: 'system', writable: false, why: 'whoever wrote it' },
      { name: 'author_name', kind: 'system', writable: false, why: 'whoever wrote it' },
      { name: 'text', kind: 'longtext' },
    ],
  },
  {
    table: 'crm_lists', label: 'lists',
    lifecycle: { create: 'crm.manageLists', delete: 'crm.manageLists' },
    columns: [
      ...SYSTEM,
      { name: 'name', kind: 'text' },
      { name: 'description', kind: 'longtext' },
      { name: 'owner_id', kind: 'system', writable: false, why: 'whoever made it' },
      { name: 'is_global', kind: 'bool', writable: false, why: 'there is exactly one, enforced by an index' },
      { name: 'color', kind: 'text' },
    ],
  },
  {
    table: 'crm_list_members', label: 'list shares',
    columns: [
      { name: 'list_id', kind: 'system', writable: false, why: 'which list' },
      { name: 'user_id', kind: 'system', writable: false, why: 'who it is shared with' },
      { name: 'can_edit', kind: 'bool' },
      { name: 'added_at', kind: 'system', writable: false, why: 'set on insert' },
    ],
  },
  {
    table: 'brand_assets', label: 'brand assets',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on insert' },
      { name: 'name', kind: 'text' },
      { name: 'type', kind: 'enum', values: ['logo', 'font', 'color', 'template', 'image'] },
      { name: 'url', kind: 'text' },
      { name: 'category', kind: 'text' },
    ],
  },
  {
    table: 'news_items', label: 'news',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on ingest' },
      { name: 'title', kind: 'text' },
      { name: 'source', kind: 'text' },
      { name: 'url', kind: 'text', writable: false, why: 'the deduplication key' },
      { name: 'summary', kind: 'longtext' },
      { name: 'published_date', kind: 'date' },
      { name: 'image_url', kind: 'text' },
      { name: 'author', kind: 'text' },
    ],
  },
  {
    table: 'news_sources', label: 'news sources',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'updated_at', kind: 'system', writable: false, why: 'set on edit' },
      { name: 'name', kind: 'text' },
      { name: 'backdrop_url', kind: 'text' },
    ],
  },
  {
    table: 'profiles', label: 'people',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'the sign in identity' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on signup' },
      { name: 'email', kind: 'text', writable: false, why: 'changed through sign in, not here' },
      { name: 'full_name', kind: 'text' },
      { name: 'role', kind: 'enum', values: ['admin', 'marketer', 'sales', 'viewer'] },
      { name: 'theme', kind: 'enum', values: ['dark', 'light'] },
      { name: 'dashboard_variant', kind: 'enum', values: ['rep', 'exec', 'support'] },
    ],
  },
  {
    table: 'notifications', label: 'notifications',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on raise' },
      { name: 'user_id', kind: 'system', writable: false, why: 'the recipient' },
      { name: 'kind', kind: 'enum', writable: false, why: 'set by whatever raised it',
        values: ['lead_assigned', 'message', 'system_alert', 'sync_failure', 'yoy_anomaly',
                 'meeting_invited', 'meeting_accepted', 'meeting_declined',
                 'meeting_proposed', 'meeting_cancelled', 'meeting_moved'] },
      { name: 'title', kind: 'text', writable: false, why: 'written by whatever raised it' },
      { name: 'body', kind: 'longtext', writable: false, why: 'written by whatever raised it' },
      { name: 'link_path', kind: 'text', writable: false, why: 'written by whatever raised it' },
      { name: 'read_at', kind: 'date' },
      { name: 'dismissed_at', kind: 'date' },
    ],
  },
  {
    table: 'dashboard_actions', label: 'next actions',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on insert' },
      { name: 'user_id', kind: 'system', writable: false, why: 'whose queue' },
      { name: 'contact_id', kind: 'system', writable: false, why: 'which customer' },
      { name: 'stock_trailer_id', kind: 'system', writable: false, why: 'which unit' },
      { name: 'type', kind: 'enum', values: ['call', 'email', 'meeting', 'quote_followup', 'custom'] },
      { name: 'title', kind: 'text' },
      { name: 'due_at', kind: 'date' },
      { name: 'priority', kind: 'number' },
      { name: 'created_by', kind: 'system', writable: false, why: 'whoever assigned it' },
      { name: 'completed_at', kind: 'date' },
      { name: 'dismissed_at', kind: 'date' },
    ],
  },
  {
    table: 'revenue_targets', label: 'targets',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'created_at', kind: 'system', writable: false, why: 'set on insert' },
      { name: 'user_id', kind: 'system', writable: false, why: 'whose target, or null for the company' },
      { name: 'period_month', kind: 'date' },
      { name: 'target_amount', kind: 'money' },
    ],
  },
  {
    table: 'account_ownership', label: 'account owners',
    columns: [
      { name: 'contact_id', kind: 'system', writable: false, why: 'which account' },
      { name: 'user_id', kind: 'system', writable: false, why: 'which person' },
      { name: 'role_on_account', kind: 'enum', values: ['owner', 'support', 'shadow'] },
      { name: 'assigned_at', kind: 'system', writable: false, why: 'set on assignment' },
    ],
  },
  {
    table: 'maint_accounts', label: 'maintenance accounts',
    columns: [
      ...SYSTEM,
      { name: 'owner_id', kind: 'system', writable: false, why: 'whose account' },
      { name: 'date_of_update', kind: 'date' },
      { name: 'status', kind: 'text' },
      { name: 'company_name', kind: 'text' },
      { name: 'contact_name', kind: 'text' },
      { name: 'phone', kind: 'text' },
      { name: 'email', kind: 'text' },
      { name: 'location', kind: 'text' },
      { name: 'services', kind: 'text' },
      { name: 'vehicles', kind: 'text' },
      { name: 'requirements', kind: 'longtext' },
      { name: 'update_log', kind: 'longtext' },
      { name: 'next_action', kind: 'text' },
      { name: 'category', kind: 'text' },
    ],
  },
  {
    table: 'lusha_credits', label: 'Lusha credits',
    columns: [
      { name: 'id', kind: 'system', writable: false, why: 'identifier' },
      { name: 'updated_at', kind: 'system', writable: false, why: 'set on change' },
      { name: 'balance', kind: 'number', writable: false, why: 'spent by searching, not typed' },
    ],
  },
  /* NOTHING WRITES THIS TABLE ANY MORE.

     `schema.sql` marks `trailer_sales` as replaced by `stock_trailers`,
     and the last thing that wrote it was /api/trailers/sync, which is
     deleted: its only caller was a component removed in 93388fc, and no
     external system could have called it because the guard reads a
     session cookie. It stays described here because the table is still
     in the database, and it is addressable by nothing: there is no
     entity for it in `schema.ts`, so no column of it reaches the
     writable allowlist. */
  {
    table: 'trailer_sales', label: 'legacy listings',
    columns: [
      ...SYSTEM,
      { name: 'make', kind: 'text' },
      { name: 'model', kind: 'text' },
      { name: 'year', kind: 'number' },
      { name: 'price', kind: 'money' },
      { name: 'status', kind: 'enum', values: ['available', 'reserved', 'sold'] },
      { name: 'location', kind: 'text' },
      { name: 'description', kind: 'longtext' },
      { name: 'images', kind: 'system', writable: false, why: 'a list of urls' },
      { name: 'external_id', kind: 'system', writable: false, why: 'the sync key from the spreadsheet' },
    ],
  },
];

/** Every column somebody could reasonably type a value into. */
export function writableColumns(table: string): ColumnSpec[] {
  return (TABLES.find((t) => t.table === table)?.columns ?? []).filter((c) => c.writable !== false);
}

export function allColumns(): { table: string; column: ColumnSpec }[] {
  return TABLES.flatMap((t) => t.columns.map((column) => ({ table: t.table, column })));
}

/**
 * Words for a column nobody has written words for.
 *
 * Poor by comparison with a hand written alias list, and that is the
 * point: it is the floor, not the ceiling. `refurb_costs_at_sale`
 * becomes "refurb costs at sale", which nobody says, but it means the
 * column can be reached by somebody who knows what it is called, rather
 * than not at all.
 */
export function derivedAliases(column: string): string[] {
  const spaced = column.replace(/_/g, ' ').trim();
  /* The raw column name is deliberately not an alias when it has an
     underscore in it. Matching softens the sentence first, so
     "dispatch_date" becomes "dispatch date" before anything compares it
     and the underscored form can never match. It was worse than dead
     weight: it counted as the field's first alias, so the generated
     sweep built sentences around a word nobody can type. */
  const out = new Set<string>([spaced]);
  if (!column.includes('_')) out.add(column);

  // Trailing nouns people drop: "order date" is also "order".
  const dropped = spaced.replace(/\b(date|at|no|url|count|id)\b\s*$/, '').trim();
  if (dropped.length >= 3 && dropped !== spaced) out.add(dropped);

  // British spellings both ways, since half the schema is American.
  if (spaced.includes('color')) out.add(spaced.replace(/color/g, 'colour'));
  if (spaced.includes('colour')) out.add(spaced.replace(/colour/g, 'color'));

  return [...out].filter((a) => a.length >= 3);
}
