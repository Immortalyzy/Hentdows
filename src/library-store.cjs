const { DatabaseSync } = require('node:sqlite');
const { randomInt } = require('node:crypto');
const path = require('node:path');
const {galleryFromUrl}=require('./sites.cjs');
const {bookSourceUrl}=require('./book-source.cjs');

const SORTS = { title: 'title_key', artist: 'author_key', pages: 'pages', downloaded: 'downloaded', finished: 'finished', uploaded: 'uploaded', readDate: 'last_read', reads: 'reads', size: 'size', progress: 'progress', average: 'average_size', random: 'shuffle', custom: 'custom_order' };
const SUMMARY = 'b.id,b.title,b.author,b.site,b.source_id,b.url,b.pages,b.size,b.favourite,b.rating,b.completed,b.reads,b.progress,b.missing,b.cover,b.last_page,b.downloaded,b.finished,b.tags';
const norm = value => String(value || '').normalize('NFKC').toLowerCase();
const integer = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const TYPES = ['artist','circle','series','character','language','tag','category','uploader','translator','publisher'];
function attributes(tags) {
  return [...new Map(tags.map(tag => {
    const text = String(tag).trim(), colon = text.indexOf(':');
    let kind = colon > 0 ? norm(text.slice(0, colon)) : 'tag', name = colon > 0 ? text.slice(colon + 1) : text;
    if (kind === 'parody' || kind === 'serie') kind = 'series';
    if (kind === 'group') kind = 'circle';
    if (!TYPES.includes(kind)) { kind = 'tag'; name = text; }
    return [`${kind}:${norm(name)}`, { kind, name, key: norm(name) }];
  })).values()].filter(a => a.name);
}
function criteria(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid library query.');
  return { query: String(input.query || '').slice(0, 500), sort: Object.hasOwn(SORTS, input.sort) ? input.sort : 'downloaded', desc: input.desc !== false,
    offset: integer(input.offset, 0, 10000000, 0), limit: integer(input.limit, 1, 200, 60), favourite: [-1,0,1].includes(input.favourite) ? input.favourite : -1,
    completed: [-1,0,1].includes(input.completed) ? input.completed : -1, rating: integer(input.rating, -1, 5, -1), ratingAtLeast: input.ratingAtLeast === true, pageFavourite: input.pageFavourite === true,
    combination: input.combination === 'or' ? 'or' : 'and', group: integer(input.group, 0, 1e9, 0), ungrouped: input.ungrouped === true,
    root: integer(input.root, 0, 1e9, 0), missing: input.missing === true,
    day: /^\d{4}-\d{2}-\d{2}$/.test(input.day || '') ? input.day : '',
    attrs: Array.isArray(input.attrs) ? input.attrs.slice(0, 40).filter(a => a && [...TYPES,'source'].includes(a.kind)).map(a => ({ kind:a.kind, name: norm(a.name).slice(0,200), excluded: a.excluded === true })) : [],
    excludedTypes: Array.isArray(input.excludedTypes) ? input.excludedTypes.filter(t => TYPES.includes(t)) : [] };
}
class LibraryStore {
  constructor(file) {
    this.db = new DatabaseSync(file); this.statements = new Map();
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS roots(id INTEGER PRIMARY KEY,path TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY,path TEXT UNIQUE NOT NULL,root INTEGER REFERENCES roots(id),signature TEXT NOT NULL,
      title TEXT NOT NULL,title_key TEXT NOT NULL,author TEXT NOT NULL,author_key TEXT NOT NULL,site TEXT NOT NULL,source_id TEXT NOT NULL,url TEXT NOT NULL,
      pages INTEGER NOT NULL,size INTEGER NOT NULL,average_size REAL NOT NULL,downloaded INTEGER NOT NULL,finished INTEGER NOT NULL,uploaded INTEGER NOT NULL,
      favourite INTEGER NOT NULL DEFAULT 0,rating INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,reads INTEGER NOT NULL DEFAULT 0,
      last_read INTEGER NOT NULL DEFAULT 0,last_page INTEGER NOT NULL DEFAULT 0,progress REAL NOT NULL DEFAULT 0,shuffle INTEGER NOT NULL,
      files TEXT NOT NULL,cover TEXT,tags TEXT NOT NULL,edited INTEGER NOT NULL DEFAULT 0,missing INTEGER NOT NULL DEFAULT 0,seen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS attrs(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,key TEXT NOT NULL,UNIQUE(kind,key));
      CREATE TABLE IF NOT EXISTS book_attrs(book INTEGER REFERENCES books(id) ON DELETE CASCADE,attr INTEGER REFERENCES attrs(id),PRIMARY KEY(book,attr));
      CREATE INDEX IF NOT EXISTS attrs_books ON book_attrs(attr,book);
      CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,filters TEXT,position INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS book_groups(book INTEGER REFERENCES books(id) ON DELETE CASCADE,grp INTEGER REFERENCES groups(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(book,grp));
      CREATE INDEX IF NOT EXISTS groups_books ON book_groups(grp,position,book);
      CREATE TABLE IF NOT EXISTS book_order(scope TEXT NOT NULL,book INTEGER REFERENCES books(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(scope,book));
      CREATE TABLE IF NOT EXISTS page_state(book INTEGER REFERENCES books(id) ON DELETE CASCADE,page INTEGER NOT NULL,read INTEGER NOT NULL DEFAULT 0,favourite INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(book,page));
      CREATE TABLE IF NOT EXISTS detached(path TEXT PRIMARY KEY);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title,attrs,tokenize='trigram');
      CREATE INDEX IF NOT EXISTS books_root ON books(root,seen);
      CREATE INDEX IF NOT EXISTS books_source ON books(source_id);
      PRAGMA user_version=1; PRAGMA application_id=1213482060;`);
    for (const field of Object.values(SORTS).filter(f => f !== 'custom_order')) this.db.exec(`CREATE INDEX IF NOT EXISTS sort_${field} ON books(${field},id)`);
  }
  sql(sql) { if (!this.statements.has(sql)) { if (this.statements.size > 250) this.statements.clear(); this.statements.set(sql, this.db.prepare(sql)); } return this.statements.get(sql); }
  transaction(fn) { if(this.db.isTransaction)return fn();this.db.exec('BEGIN'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  roots() { return this.sql('SELECT * FROM roots ORDER BY id').all(); }
  rootStats() { return this.sql('SELECT r.*,count(b.id) books,coalesce(sum(b.size),0) bytes FROM roots r LEFT JOIN books b ON b.root=r.id GROUP BY r.id ORDER BY r.id').all(); }
  removeRoot(id) {
    return this.transaction(()=>{
      const root=this.roots().find(r=>r.id===id);if(!root)throw new Error('Storage location not found.');
      this.sql('DELETE FROM search WHERE rowid IN (SELECT id FROM books WHERE root=?)').run(id);
      this.sql('DELETE FROM books WHERE root=?').run(id);this.sql('DELETE FROM roots WHERE id=?').run(id);
    });
  }
  relocateRoot(id,directory) {
    return this.transaction(()=>{
      const root=this.roots().find(r=>r.id===id);if(!root)throw new Error('Storage location not found.');
      for(const book of this.sql('SELECT id,path FROM books WHERE root=?').all(id))this.sql('UPDATE books SET path=? WHERE id=?').run(path.join(directory,path.relative(root.path,book.path)),book.id);
      for(const item of this.sql('SELECT path FROM detached').all()){
        const relative=path.relative(root.path,item.path);
        if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))this.sql('UPDATE detached SET path=? WHERE path=?').run(path.join(directory,relative),item.path);
      }
      this.sql('UPDATE roots SET path=? WHERE id=?').run(directory,id);
    });
  }
  browserMarks(galleries) {
    if(!Array.isArray(galleries)||galleries.length>300)throw new Error('Invalid page markers.');
    return galleries.map(g=>{const book=this.findSource(g);return {url:g.url,downloaded:Boolean(book),tags:book?JSON.parse(this.sql('SELECT tags FROM books WHERE id=?').get(book.id).tags):[]};});
  }
  findSource({site,sourceId}) { return ['ehentai','exhentai'].includes(site)?this.sql("SELECT id,path FROM books WHERE site IN ('ehentai','exhentai') AND source_id=? AND missing=0 LIMIT 1").get(String(sourceId)):this.sql('SELECT id,path FROM books WHERE site=? AND source_id=? AND missing=0 LIMIT 1').get(site,String(sourceId)); }
  duplicateCandidates({word,offset=0}) {
    word=norm(word).slice(0,200);if(word.length<2)return [];
    const term=word.length>=3?'b.id IN (SELECT rowid FROM search WHERE search MATCH ?)':'instr(b.title_key,?)>0';
    return this.sql(`SELECT b.id,b.title,b.site,b.source_id,b.pages,b.size,b.tags,b.path FROM books b WHERE missing=0 AND ${term} ORDER BY b.id LIMIT 100 OFFSET ?`).all(word.length>=3?'title : "'+word.replaceAll('"','""')+'"':word,integer(offset,0,10000000,0)).map(b=>({...b,tags:JSON.parse(b.tags)}));
  }
  indexed(paths) { return paths.filter(p=>Boolean(this.byPath(p))); }
  addRoot(directory) { this.sql('INSERT OR IGNORE INTO roots(path) VALUES(?)').run(directory); return this.sql('SELECT * FROM roots WHERE path=?').get(directory); }
  byPath(directory) { return this.sql('SELECT id,signature FROM books WHERE path=?').get(directory); }
  isDetached(directory) { return Boolean(this.sql('SELECT 1 FROM detached WHERE path=?').get(directory)); }
  markSeen(id, seen) { this.sql('UPDATE books SET seen=?,missing=0 WHERE id=?').run(seen,id); }
  index(book) {
    return this.transaction(() => {
      const old = this.sql('SELECT * FROM books WHERE path=?').get(book.path);
      const tags = old?.edited ? JSON.parse(old.tags) : book.tags, title = old?.edited ? old.title : book.title;
      const attrs = attributes(tags), author = attrs.filter(a => ['artist','circle'].includes(a.kind)).map(a => a.name).join(', ');
      const fields = { path:book.path,root:book.root,signature:book.signature,title,title_key:norm(title),author,author_key:norm(author),site:book.site,source_id:book.sourceId,url:book.url,
        pages:book.pages,size:book.size,average_size:book.pages ? book.size/book.pages : 0,downloaded:book.downloaded,finished:book.finished,uploaded:book.uploaded || 0,
        shuffle:old?.shuffle ?? randomInt(0x7fffffff),files:JSON.stringify(book.files),cover:book.cover,tags:JSON.stringify(tags),seen:book.seen,missing:0 };
      const keys = Object.keys(fields);
      this.sql(`INSERT INTO books(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')}) ON CONFLICT(path) DO UPDATE SET ${keys.filter(k => k !== 'path').map(k => `${k}=excluded.${k}`).join(',')}`).run(...Object.values(fields));
      const id = this.byPath(book.path).id;
      this.reindex(id,title,attrs);
      if(!old&&book.imported){
        const meta=book.imported;
        this.sql('UPDATE books SET favourite=?,rating=?,completed=?,reads=?,last_read=?,last_page=?,progress=? WHERE id=?').run(Number(meta.favourite),meta.rating,Number(meta.completed),meta.reads,meta.lastRead,meta.lastPage,meta.pageState.filter(s=>s.read).length/book.pages,id);
        for(const state of meta.pageState)this.sql('INSERT INTO page_state(book,page,read,favourite) VALUES(?,?,?,?)').run(id,state.page,Number(state.read),Number(state.favourite));
        for(const group of meta.groups){
          this.sql('INSERT OR IGNORE INTO groups(name,position) VALUES(?,(SELECT coalesce(max(position),0)+1 FROM groups))').run(group.name);
          const saved=this.sql('SELECT id,filters FROM groups WHERE name=?').get(group.name);
          if(!saved.filters)this.sql('INSERT OR IGNORE INTO book_groups(book,grp,position) VALUES(?,?,?)').run(id,saved.id,group.position);
        }
      }
      return id;
    });
  }
  reindex(id,title,attrs) {
    this.sql('DELETE FROM book_attrs WHERE book=?').run(id);
    for (const a of attrs) {
      this.sql('INSERT OR IGNORE INTO attrs(kind,name,key) VALUES(?,?,?)').run(a.kind,a.name,a.key);
      this.sql('INSERT OR IGNORE INTO book_attrs(book,attr) SELECT ?,id FROM attrs WHERE kind=? AND key=?').run(id,a.kind,a.key);
    }
    this.sql('DELETE FROM search WHERE rowid=?').run(id);
    this.sql('INSERT INTO search(rowid,title,attrs) VALUES(?,?,?)').run(id,norm(title),attrs.map(a => a.key).join('\n'));
  }
  finishScan(root,seen) { this.sql('UPDATE books SET missing=1 WHERE root=? AND seen<>?').run(root,seen); }
  where(input, nested = false) {
    const f = criteria(input), terms = [], args = [], add = (sql,...values) => { terms.push(sql); args.push(...values); };
    const gallery=galleryFromUrl(f.query);
    if(gallery)add('b.site=? AND b.source_id=?',gallery.site,String(gallery.id));
    else if (f.query) {
      const q=norm(f.query), parts=q.split(',').map(t=>t.trim()).filter(Boolean);
      const contains = (column, text) => {
        if ([...text].length >= 3) { args.push(`${column} : "${text.replaceAll('"','""')}"`); return 'b.id IN (SELECT rowid FROM search WHERE search MATCH ?)'; }
        args.push(text); return column === 'title' ? 'instr(b.title_key,?)>0' : 'EXISTS(SELECT 1 FROM book_attrs ba JOIN attrs a ON a.id=ba.attr WHERE ba.book=b.id AND instr(a.key,?)>0)';
      };
      const title=contains('title',q); args.push(q);
      const tags=parts.map(t=>contains('attrs',t));
      terms.push(`(${title} OR b.source_id=? ${tags.length ? `OR (${tags.join(' AND ')})` : ''})`);
    }
    for (const key of ['favourite','completed']) if (f[key] >= 0) add(`b.${key}=?`,f[key]);
    if (f.rating >= 0) add(`b.rating${f.ratingAtLeast?'>=':'='}?`,f.rating);
    if (f.pageFavourite) add('EXISTS(SELECT 1 FROM page_state p WHERE p.book=b.id AND p.favourite=1)');
    if (f.missing) add('b.missing=1');
    if (f.root) add('b.root=?',f.root);
    if (f.day) add("date(b.downloaded/1000,'unixepoch','localtime')=?",f.day);
    if (f.ungrouped) add('NOT EXISTS(SELECT 1 FROM book_groups bg WHERE bg.book=b.id)');
    if (f.group && !nested) {
      const group=this.sql('SELECT * FROM groups WHERE id=?').get(f.group);
      if (!group) add('0');
      else if (group.filters) { const nestedWhere=this.where(JSON.parse(group.filters),true); add(`(${nestedWhere.sql})`,...nestedWhere.args); }
      else add('EXISTS(SELECT 1 FROM book_groups bg WHERE bg.book=b.id AND bg.grp=?)',f.group);
    }
    const attrs=[];
    for (const a of f.attrs) {
      let sql;
      if (a.kind === 'source') { sql='b.site=?'; args.push(a.name); }
      else { sql='EXISTS(SELECT 1 FROM book_attrs ba JOIN attrs a ON a.id=ba.attr WHERE ba.book=b.id AND a.kind=? AND a.key=?)'; args.push(a.kind,a.name); }
      attrs.push(a.excluded ? `NOT (${sql})` : sql);
    }
    if (attrs.length) terms.push(`(${attrs.join(f.combination === 'or' ? ' OR ' : ' AND ')})`);
    for (const kind of f.excludedTypes) add('NOT EXISTS(SELECT 1 FROM book_attrs ba JOIN attrs a ON a.id=ba.attr WHERE ba.book=b.id AND a.kind=?)',kind);
    return { sql:terms.join(' AND ') || '1',args,f };
  }
  adjacent({id,filters,direction=1}) { return this.query(filters,{id,direction}); }
  position({id,filters}) { return this.query(filters,{id,position:true}); }
  query(input,adjacent) {
    const {sql,args,f}=this.where(input), direction=f.desc ? 'DESC' : 'ASC';
    const attr=f.attrs.find(a=>!a.excluded&&['artist','series'].includes(a.kind)),orderArgs=[];
    let order=`b.${SORTS[f.sort]}`;
    if(f.sort==='custom') {
      if(f.group)order=`(SELECT position FROM book_groups bg WHERE bg.book=b.id AND bg.grp=${f.group})`;
      else if(attr){order='coalesce((SELECT position FROM book_order bo WHERE bo.book=b.id AND bo.scope=?),b.id)';orderArgs.push(`${attr.kind}:${attr.name}`);}
      else order='b.id';
    }
    const tie=f.sort === 'reads' ? `,b.last_read ${direction},b.downloaded DESC` : '';
    if(adjacent) {
      if(adjacent.position){
        if(!Number.isInteger(adjacent.id))throw new Error('Invalid book.');
        return this.sql(`WITH ordered AS (SELECT b.id,row_number() OVER (ORDER BY ${order} ${direction}${tie},b.id ASC)-1 position FROM books b WHERE ${sql}) SELECT position FROM ordered WHERE id=?`).get(...orderArgs,...args,adjacent.id)?.position ?? null;
      }
      if(!Number.isInteger(adjacent.id)||![1,-1].includes(adjacent.direction))throw new Error('Invalid navigation.');
      return this.sql(`WITH ordered AS (SELECT b.id,row_number() OVER (ORDER BY ${order} ${direction}${tie},b.id ASC) position FROM books b WHERE ${sql}) SELECT id FROM ordered WHERE position=(SELECT position FROM ordered WHERE id=?)+?`).get(...orderArgs,...args,adjacent.id,adjacent.direction)?.id || null;
    }
    const stats=this.sql(`SELECT count(*) total,coalesce(sum(b.size),0) bytes FROM books b WHERE ${sql}`).get(...args);
    const books=this.sql(`SELECT ${SUMMARY} FROM books b WHERE ${sql} ORDER BY ${order} ${direction}${tie},b.id ASC LIMIT ? OFFSET ?`).all(...args,...orderArgs,f.limit,f.offset);
    return {...stats,books:books.map(b=>({...b,sourceUrl:bookSourceUrl(b),language:JSON.parse(b.tags).find(t=>t.startsWith('language:'))?.slice(9)||'',tags:JSON.parse(b.tags).slice(0,8)})),offset:f.offset,limit:f.limit};
  }
  get(id) {
    if (!Number.isInteger(id)) throw new Error('Invalid book.');
    const book=this.sql('SELECT * FROM books WHERE id=?').get(id);
    if (!book) throw new Error('Book not found.');
    return {...book,sourceUrl:bookSourceUrl(book),files:JSON.parse(book.files),tags:JSON.parse(book.tags),groups:this.sql('SELECT grp FROM book_groups WHERE book=?').all(id).map(g=>g.grp),pageState:this.sql('SELECT page,read,favourite FROM page_state WHERE book=?').all(id)};
  }
  suggestions({kind='tag',query='',sort='count'}={}) {
    if (kind === 'date') return this.sql("SELECT date(downloaded/1000,'unixepoch','localtime') name,count(*) count FROM books GROUP BY name ORDER BY name DESC").all();
    if (kind === 'source') return this.sql('SELECT site name,count(*) count FROM books GROUP BY site ORDER BY '+(sort==='title'?'site':'count DESC,site')).all();
    if (!TYPES.includes(kind)) throw new Error('Unknown attribute.');
    return this.sql('SELECT a.name,count(*) count FROM attrs a JOIN book_attrs ba ON ba.attr=a.id WHERE a.kind=? AND instr(a.key,?)>0 GROUP BY a.id ORDER BY '+(sort==='title'?'a.key':'count DESC,a.key')+' LIMIT 100').all(kind,norm(query).slice(0,200));
  }
  facets({kind,query='',offset=0,limit=60,sort='title',desc=false}={}) {
    const args=[],direction=desc?'DESC':'ASC';let sql;
    if(['artist','series'].includes(kind)) {sql='SELECT a.name,a.key,count(*) count,sum(b.size) size,0 id,max(b.downloaded) latest,0 position FROM attrs a JOIN book_attrs ba ON ba.attr=a.id JOIN books b ON b.id=ba.book WHERE a.kind=? AND instr(a.key,?)>0 GROUP BY a.id';args.push(kind,norm(query));}
    else if(kind==='date') {sql="SELECT date(downloaded/1000,'unixepoch','localtime') name, date(downloaded/1000,'unixepoch','localtime') key,count(*) count,sum(size) size,0 id,max(downloaded) latest,0 position FROM books GROUP BY name";}
    else if(kind==='folders') {sql='SELECT r.path name,r.path key,count(b.id) count,coalesce(sum(b.size),0) size,r.id,max(b.downloaded) latest,0 position FROM roots r LEFT JOIN books b ON b.root=r.id GROUP BY r.id';}
    else if(['custom','dynamic'].includes(kind)) {sql=`SELECT g.name,lower(g.name) key,count(bg.book) count,coalesce(sum(b.size),0) size,g.id,max(b.downloaded) latest,g.position FROM groups g LEFT JOIN book_groups bg ON bg.grp=g.id LEFT JOIN books b ON b.id=bg.book WHERE g.filters IS ${kind==='custom'?'':'NOT '}NULL AND instr(lower(g.name),?)>0 GROUP BY g.id`;args.push(norm(query));}
    else throw new Error('Unknown grouping.');
    const order={title:'key',pages:'count',downloaded:'latest',custom:'position'}[sort]||'key';
    const entries=this.sql(`SELECT * FROM (${sql}) ORDER BY ${order} ${direction},id LIMIT ? OFFSET ?`).all(...args,integer(limit,1,200,60),integer(offset,0,10000000,0));
    if(kind==='dynamic')for(const entry of entries){const w=this.where({group:entry.id});Object.assign(entry,this.sql(`SELECT count(*) count,coalesce(sum(size),0) size FROM books b WHERE ${w.sql}`).get(...w.args));}
    return {total:this.sql(`SELECT count(*) count FROM (${sql})`).get(...args).count,entries};
  }
  update({ids,patch}) {
    if (!Array.isArray(ids) || !ids.length || ids.length>1000 || ids.some(id=>!Number.isInteger(id))) throw new Error('Select between 1 and 1000 books.');
    const values={};
    for (const key of Object.keys(patch || {})) {
      const val=patch[key];
      if (['favourite','completed'].includes(key) && typeof val === 'boolean') values[key]=Number(val);
      else if (key === 'rating' && Number.isInteger(val) && val>=0 && val<=5) values.rating=val;
      else if (key === 'title' && ids.length === 1 && typeof val === 'string' && val.trim() && val.length<=2000) { values.title=val.trim(); values.title_key=norm(val.trim()); values.edited=1; }
      else if (key === 'tags' && ids.length === 1 && Array.isArray(val) && val.length<=500 && val.every(t=>typeof t==='string'&&t.length<=200)) { values.tags=JSON.stringify(val); values.edited=1; }
      else if (key === 'resetRead' && val === true) { values.reads=0; values.last_read=0; values.last_page=0; values.progress=0; }
      else throw new Error('Invalid library edit.');
    }
    if (!Object.keys(values).length) return;
    this.transaction(()=>{for (const id of ids) {
      this.get(id);
      this.sql(`UPDATE books SET ${Object.keys(values).map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...Object.values(values),id);
      if (patch.resetRead) this.sql('UPDATE page_state SET read=0 WHERE book=?').run(id);
      if (values.edited) { const b=this.get(id), attrs=attributes(b.tags), author=attrs.filter(a=>['artist','circle'].includes(a.kind)).map(a=>a.name).join(', '); this.sql('UPDATE books SET author=?,author_key=? WHERE id=?').run(author,norm(author),id); this.reindex(id,b.title,attrs); }
    }});
  }
  read({id,page,open=false,favourite,complete=false}) {
    const b=this.get(id);
    if (!Number.isInteger(page)||page<0||page>=b.files.length) throw new Error('Invalid page.');
    this.transaction(()=>{
      this.sql('INSERT OR IGNORE INTO page_state(book,page) VALUES(?,?)').run(id,page);
      if (typeof favourite === 'boolean') this.sql('UPDATE page_state SET favourite=? WHERE book=? AND page=?').run(Number(favourite),id,page);
      else {
        this.sql('UPDATE page_state SET read=1 WHERE book=? AND page=?').run(id,page);
        this.sql('UPDATE books SET reads=reads+?,last_read=?,last_page=?,progress=(SELECT count(*) FROM page_state WHERE book=? AND read=1)*1.0/? WHERE id=?').run(open?1:0,Date.now(),page,id,b.files.length,id);
      }
      if(complete===true)this.sql('UPDATE books SET completed=1 WHERE id=?').run(id);
    });
  }
  groups() { return this.sql('SELECT g.*,count(bg.book) books FROM groups g LEFT JOIN book_groups bg ON bg.grp=g.id GROUP BY g.id ORDER BY position,g.name').all().map(g=>({...g,filters:g.filters?JSON.parse(g.filters):null})); }
  group({action,id,name,filters,ids,direction}) {
    if (action==='save') {
      if (typeof name!=='string'||!name.trim()||name.length>120) throw new Error('Enter a group name (1–120 characters).');
      const saved=filters ? JSON.stringify({...criteria(filters),group:0,offset:0}) : null;
      if (id) this.sql('UPDATE groups SET name=?,filters=? WHERE id=?').run(name.trim(),saved,id);
      else return Number(this.sql('INSERT INTO groups(name,filters,position) VALUES(?,?,(SELECT coalesce(max(position),0)+1 FROM groups))').run(name.trim(),saved).lastInsertRowid);
    } else if(action==='delete') this.sql('DELETE FROM groups WHERE id=?').run(id);
    else if(action==='assign'||action==='remove') {
      const group=this.sql('SELECT * FROM groups WHERE id=?').get(id);
      if(!group||group.filters) throw new Error('Choose a custom group.');
      if(!Array.isArray(ids)||ids.length>1000) throw new Error('Invalid selection.');
      this.transaction(()=>{for(const book of ids) { this.get(book); if(action==='remove') this.sql('DELETE FROM book_groups WHERE book=? AND grp=?').run(book,id); else this.sql('INSERT OR IGNORE INTO book_groups(book,grp,position) VALUES(?,?,(SELECT coalesce(max(position),0)+1 FROM book_groups WHERE grp=?))').run(book,id,id); }});
    } else if(action==='move') {
      if(![1,-1].includes(direction)||!Array.isArray(ids)||ids.length!==1) throw new Error('Choose one book to move.');
      if(!id){
        const attr=criteria(filters).attrs.find(a=>!a.excluded&&['artist','series'].includes(a.kind));
        if(!attr)throw new Error('Open a custom, artist or series group to reorder books.');
        const scope=`${attr.kind}:${attr.name}`,where=this.where({attrs:[attr]});
        const rows=this.sql(`SELECT b.id book,coalesce((SELECT position FROM book_order bo WHERE bo.book=b.id AND bo.scope=?),b.id) position FROM books b WHERE ${where.sql} ORDER BY position,b.id`).all(scope,...where.args),at=rows.findIndex(r=>r.book===ids[0]),next=at+direction;
        if(at<0||next<0||next>=rows.length)return;
        this.transaction(()=>{for(const [a,b] of [[at,next],[next,at]])this.sql('INSERT INTO book_order(scope,book,position) VALUES(?,?,?) ON CONFLICT(scope,book) DO UPDATE SET position=excluded.position').run(scope,rows[a].book,rows[b].position);});return;
      }
      const rows=this.sql('SELECT book,position FROM book_groups WHERE grp=? ORDER BY position').all(id), at=rows.findIndex(r=>r.book===ids[0]), next=at+direction;
      if(at<0||next<0||next>=rows.length) return;
      this.transaction(()=>{this.sql('UPDATE book_groups SET position=? WHERE grp=? AND book=?').run(rows[next].position,id,rows[at].book);this.sql('UPDATE book_groups SET position=? WHERE grp=? AND book=?').run(rows[at].position,id,rows[next].book);});
    } else if(action==='moveGroup'){
      if(![1,-1].includes(direction))throw new Error('Invalid direction.');const rows=this.groups(),at=rows.findIndex(g=>g.id===id),next=at+direction;if(at<0||next<0||next>=rows.length)return;
      this.transaction(()=>{this.sql('UPDATE groups SET position=? WHERE id=?').run(rows[next].position,id);this.sql('UPDATE groups SET position=? WHERE id=?').run(rows[at].position,rows[next].id);});
    } else throw new Error('Invalid group action.');
  }
  detach(ids) { this.transaction(()=>{for(const id of ids) { const book=this.get(id); this.sql('INSERT OR IGNORE INTO detached(path) VALUES(?)').run(book.path); this.sql('DELETE FROM search WHERE rowid=?').run(id); this.sql('DELETE FROM books WHERE id=?').run(id); }}); }
  restoreDetached() { this.db.exec('DELETE FROM detached'); }
  restore(file) {
    this.sql('ATTACH DATABASE ? AS restored').run(file);
    try {
      if(this.db.prepare('PRAGMA restored.application_id').get().application_id!==1213482060||this.db.prepare('PRAGMA restored.user_version').get().user_version!==1)throw new Error('This is not a supported Hentdows library backup.');
      this.transaction(()=>{
        this.db.exec('DELETE FROM search; DELETE FROM book_order; DELETE FROM page_state; DELETE FROM book_groups; DELETE FROM book_attrs; DELETE FROM books; DELETE FROM roots; DELETE FROM groups; DELETE FROM attrs; DELETE FROM detached;');
        for(const table of ['roots','books','attrs','book_attrs','groups','book_groups','page_state','book_order','detached'])this.db.exec(`INSERT INTO main.${table} SELECT * FROM restored.${table}`);
        this.db.exec('INSERT INTO main.search(rowid,title,attrs) SELECT rowid,title,attrs FROM restored.search');
      });
    } finally {this.db.exec('DETACH DATABASE restored');}
  }
  shuffle() { this.db.exec('UPDATE books SET shuffle=abs(random()%2147483647)'); }
  close() { this.db.close(); }
}
module.exports={LibraryStore,criteria,attributes,SORTS};
