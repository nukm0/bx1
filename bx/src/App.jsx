import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Heart, MapPin, ArrowLeft, X, PackageOpen, SlidersHorizontal } from 'lucide-react';

const categories = ['Все', 'Электроника', 'Одежда', 'Дом и сад', 'Хобби', 'Детское', 'Транспорт', 'Другое'];
const fallback = [
  { id:'demo1', title:'Винтажный фотоаппарат', price:4500, category:'Электроника', city:'Москва', description:'Рабочий фотоаппарат в хорошем состоянии.', image:'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800', seller:'Алексей' },
  { id:'demo2', title:'Кресло в скандинавском стиле', price:7200, category:'Дом и сад', city:'Санкт-Петербург', description:'Удобное кресло, есть небольшие следы использования.', image:'https://images.unsplash.com/photo-1503602642458-232111445657?w=800', seller:'Мария' },
  { id:'demo3', title:'Красные кроссовки', price:2500, category:'Одежда', city:'Казань', description:'Почти новые, надевал пару раз.', image:'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800', seller:'Денис' },
  { id:'demo4', title:'Настольная лампа', price:900, category:'Дом и сад', city:'Москва', description:'Минималистичная лампа, отлично работает.', image:'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800', seller:'Ольга' }
];
const money = n => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';

export default function App() {
  const [items, setItems] = useState(fallback);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Все');
  const [favorites, setFavorites] = useState([]);
  const [page, setPage] = useState('home');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title:'', price:'', category:'Электроника', city:'', description:'', image:'' });
  const user = tg?.initDataUnsafe?.user;
  const userName = user?.first_name || 'Пользователь';

  useEffect(() => {
    tg?.ready(); tg?.expand();
    if (tg?.themeParams?.bg_color) document.documentElement.style.setProperty('--tg-bg', tg.themeParams.bg_color);
    fetch('/api/listings').then(r => r.ok ? r.json() : Promise.reject()).then(setItems).catch(() => {});
  }, []);

  const visible = useMemo(() => items.filter(x =>
    (category === 'Все' || x.category === category) &&
    `${x.title} ${x.description} ${x.city}`.toLowerCase().includes(search.toLowerCase()) &&
    (page !== 'favorites' || favorites.includes(x.id))
  ), [items, category, search, page, favorites]);

  const updateForm = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const createListing = async e => {
    e.preventDefault();
    const listing = { ...form, price: Number(form.price), seller: userName };
    try {
      const r = await fetch('/api/listings', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Telegram-Init-Data':initData }, body:JSON.stringify(listing) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error || 'Не удалось создать объявление'); }
      const saved = await r.json(); setItems(old => [saved, ...old]);
    } catch (err) {
      if (!String(err.message).includes('Failed to fetch') && !String(err.message).includes('NetworkError')) { setNotice(err.message); return; }
      setItems(old => [{ ...listing, id:crypto.randomUUID() }, ...old]);
      setNotice('Демо-режим: объявление сохранено только до перезагрузки страницы.');
    }
    setForm({ title:'', price:'', category:'Электроника', city:'', description:'', image:'' });
    setPage('home');
  };

  const toggleFavorite = id => setFavorites(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const openItem = item => { setSelected(item); setPage('detail'); };
  const back = () => { setSelected(null); setPage('home'); };
  const setTab = tab => { setSelected(null); setPage(tab); };

  return <div className="app">
    <header className="topbar">
      <button className="brand" onClick={() => setTab('home')}><span className="brand-icon">б</span><span>барахолка<small>вещи находят людей</small></span></button>
      <button className="round-button" onClick={() => setTab('favorites')} aria-label="Избранное"><Heart size={20}/>{favorites.length > 0 && <i>{favorites.length}</i>}</button>
    </header>

    {page === 'detail' && selected ? <main className="detail-page">
      <button className="back" onClick={back}><ArrowLeft size={18}/> Назад к объявлениям</button>
      <img className="detail-image" src={selected.image || 'https://images.unsplash.com/photo-1491637639811-60e2756cc1c7?w=800'} onError={e => e.currentTarget.style.display='none'} />
      <div className="detail-content"><span className="eyebrow">{selected.category}</span><h1>{selected.title}</h1><div className="detail-price">{money(selected.price)}</div>
        <div className="location"><MapPin size={16}/>{selected.city}</div><p>{selected.description || 'Продавец пока не добавил описание.'}</p>
        <div className="seller"><div className="avatar">{(selected.seller || 'П')[0]}</div><div><b>{selected.seller || 'Пользователь'}</b><small>Продавец</small></div></div>
        <button className="primary full" onClick={() => tg?.openTelegramLink ? tg.openTelegramLink('https://t.me/') : setNotice('Добавьте ссылку на свой Telegram в профиль продавца, чтобы покупатели могли написать вам.')}>Написать продавцу</button>
        <button className="secondary full" onClick={() => toggleFavorite(selected.id)}><Heart size={18} fill={favorites.includes(selected.id) ? 'currentColor' : 'none'}/>{favorites.includes(selected.id) ? 'В избранном' : 'В избранное'}</button>
      </div>
    </main> : page === 'create' ? <main className="form-page">
      <button className="back" onClick={back}><ArrowLeft size={18}/> Назад</button><h1>Новое объявление</h1><p className="muted">Расскажите о вещи — покупатель найдётся.</p>
      <form onSubmit={createListing} className="listing-form">
        <label>Название *<input required maxLength="100" placeholder="Например, велосипед" value={form.title} onChange={e=>updateForm('title',e.target.value)}/></label>
        <label>Цена, ₽ *<input required type="number" min="0" step="1" placeholder="0" value={form.price} onChange={e=>updateForm('price',e.target.value)}/></label>
        <label>Категория *<select value={form.category} onChange={e=>updateForm('category',e.target.value)}>{categories.filter(x=>x!=='Все').map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Город *<input required placeholder="Ваш город" value={form.city} onChange={e=>updateForm('city',e.target.value)}/></label>
        <label>Ссылка на фото<input type="url" placeholder="https://..." value={form.image} onChange={e=>updateForm('image',e.target.value)}/><small>Пока поддерживается ссылка на изображение.</small></label>
        <label>Описание<textarea rows="4" maxLength="2000" placeholder="Состояние, размер, особенности..." value={form.description} onChange={e=>updateForm('description',e.target.value)}/></label>
        <button className="primary full" type="submit"><Plus size={18}/> Опубликовать объявление</button>
      </form>
    </main> : <main>
      <section className="hero"><div className="hero-copy"><span className="hero-pill">♻️ Дай вещам вторую жизнь</span><h1>Хорошие вещи.<br/><em>Хорошие цены.</em></h1><p>Покупай рядом, продавай легко.</p></div><div className="hero-art">🛍️</div></section>
      <div className="search-wrap"><Search size={20}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Что ищем сегодня?"/>{search && <button onClick={()=>setSearch('')}><X size={17}/></button>}</div>
      <div className="section-heading"><h2>{page === 'favorites' ? 'Избранное' : 'Категории'}</h2><span><SlidersHorizontal size={15}/> {visible.length} объявл.</span></div>
      {page !== 'favorites' && <div className="categories">{categories.map((c,i)=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}><span>{['✳️','📱','👕','🪴','🎨','🧸','🚲','📦'][i]}</span>{c}</button>)}</div>}
      <div className="section-heading listings-heading"><h2>{page === 'favorites' ? 'Сохранённые товары' : 'Свежие находки'}</h2><span>Сначала новые</span></div>
      {visible.length ? <div className="product-grid">{visible.map(item=><article className="product" key={item.id}>
        <button className="product-image" onClick={()=>openItem(item)}><img src={item.image || 'https://images.unsplash.com/photo-1491637639811-60e2756cc1c7?w=800'} onError={e=>e.currentTarget.src='https://images.unsplash.com/photo-1491637639811-60e2756cc1c7?w=800'} alt={item.title}/></button>
        <button className={`heart ${favorites.includes(item.id)?'liked':''}`} onClick={()=>toggleFavorite(item.id)} aria-label="В избранное"><Heart size={18} fill={favorites.includes(item.id)?'currentColor':'none'}/></button>
        <button className="product-info" onClick={()=>openItem(item)}><strong>{money(item.price)}</strong><span>{item.title}</span><small><MapPin size={12}/>{item.city}</small></button>
      </article>)}</div> : <div className="empty"><PackageOpen size={38}/><b>Пока ничего не найдено</b><span>Попробуйте изменить поиск или категорию.</span></div>}
    </main>}

    {notice && <div className="toast" onClick={()=>setNotice('')}>{notice}<button><X size={15}/></button></div>}
    <nav className="bottom-nav">
      <button className={page==='home'?'selected':''} onClick={()=>setTab('home')}><span>⌂</span>Главная</button>
      <button className={page==='favorites'?'selected':''} onClick={()=>setTab('favorites')}><Heart size={21}/>Избранное</button>
      <button className="sell-button" onClick={()=>setPage('create')}><span><Plus size={22}/></span>Продать</button>
    </nav>
  </div>;
}