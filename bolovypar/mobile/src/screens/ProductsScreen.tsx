import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { commerceApi, type Product } from '../services/commerceApi';
import { colors, spacing } from '../theme/tokens';
import { Choice, Notice, Row, SectionTitle, decimal, parseDecimal, rupees } from './CommerceCommon';

type UnitForm = { id?: string; unit_name: string; price: string; factor: string; active: boolean };
const newUnit = (): UnitForm => ({ unit_name: 'piece', price: '', factor: '1', active: true });

export function ProductsScreen() {
  const { session } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(''); const [sku, setSku] = useState(''); const [aliases, setAliases] = useState('');
  const [packaging, setPackaging] = useState(''); const [hsn, setHsn] = useState(''); const [gst, setGst] = useState('0');
  const [stock, setStock] = useState(''); const [units, setUnits] = useState<UnitForm[]>([newUnit()]);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (query = '') => {
    if (!session) return;
    setLoading(true);
    try { setProducts((await commerceApi.products(session.access_token, query)).products); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load products'); }
    finally { setLoading(false); }
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  function open(product?: Product) {
    setEditing(product ?? null); setFormOpen(true); setError(null); setMessage(null);
    setName(product?.name ?? ''); setSku(product?.sku ?? ''); setAliases(product?.aliases.join(', ') ?? '');
    setPackaging(product?.packaging ?? ''); setHsn(product?.hsn_code ?? ''); setGst(product ? decimal(product.gst_rate_bps, 2) : '0');
    setStock(product?.stock_quantity_milli == null ? '' : decimal(product.stock_quantity_milli, 3));
    setUnits(product?.units.map((unit) => ({ id: unit.id, unit_name: unit.unit_name, price: decimal(unit.standard_price_paise, 2),
      factor: decimal(unit.stock_factor_milli, 3), active: unit.active })) ?? [newUnit()]);
  }
  function updateUnit(index: number, change: Partial<UnitForm>) { setUnits((current) => current.map((unit, i) => i === index ? { ...unit, ...change } : unit)); }
  async function save() {
    if (!session) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const data = { name: name.trim(), sku: sku.trim() || null, aliases: aliases.split(',').map((s) => s.trim()).filter(Boolean),
        packaging: packaging.trim() || null, hsn_code: hsn.trim() || null, gst_rate_bps: parseDecimal(gst, 2, 'GST rate'),
        stock_quantity_milli: stock.trim() ? parseDecimal(stock, 3, 'stock quantity') : null,
        units: units.map((unit) => ({ id: unit.id, unit_name: unit.unit_name.trim(), standard_price_paise: parseDecimal(unit.price, 2, 'price'),
          stock_factor_milli: parseDecimal(unit.factor, 3, 'stock factor'), active: unit.active })) };
      await commerceApi.saveProduct(session.access_token, data, editing?.id);
      setFormOpen(false); setMessage(editing ? 'Product updated.' : 'Product added.'); await load(search);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save product'); }
    finally { setBusy(false); }
  }
  async function archive(product: Product) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      if (product.archived_at) await commerceApi.restoreProduct(session.access_token, product.id);
      else await commerceApi.archiveProduct(session.access_token, product.id);
      setMessage(`${product.name} ${product.archived_at ? 'restored' : 'archived'}.`); await load(search);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive product'); }
    finally { setBusy(false); }
  }

  return <Screen>
    <View style={styles.header}><SectionTitle>Product catalog</SectionTitle><AppButton title="Add product" onPress={() => open()} /></View>
    <Notice error={error} message={message} />
    {formOpen ? <AppCard style={styles.card}>
      <SectionTitle>{editing ? 'Edit product' : 'New product'}</SectionTitle>
      <AppField label="Product name" value={name} onChangeText={setName} />
      <Row><View style={styles.field}><AppField label="SKU" value={sku} onChangeText={setSku} /></View>
        <View style={styles.field}><AppField label="HSN code" value={hsn} onChangeText={setHsn} keyboardType="number-pad" /></View></Row>
      <AppField label="Aliases (comma separated)" value={aliases} onChangeText={setAliases} />
      <AppField label="Packaging description" value={packaging} onChangeText={setPackaging} />
      <Row><View style={styles.field}><AppField label="GST rate %" value={gst} onChangeText={setGst} keyboardType="decimal-pad" /></View>
        <View style={styles.field}><AppField label="Stock quantity (optional)" value={stock} onChangeText={setStock} keyboardType="decimal-pad" hint="Leave empty if you do not track stock." /></View></Row>
      <Text style={styles.label}>Selling units and standard prices</Text>
      {units.map((unit, index) => <View key={unit.id ?? `new-${index}`} style={styles.unit}>
        <Row><View style={styles.field}><AppField label="Unit" value={unit.unit_name} onChangeText={(value) => updateUnit(index, { unit_name: value })} placeholder="piece, box, kg" /></View>
          <View style={styles.field}><AppField label="Price (₹)" value={unit.price} onChangeText={(value) => updateUnit(index, { price: value })} keyboardType="decimal-pad" /></View>
          <View style={styles.field}><AppField label="Stock used per unit" value={unit.factor} onChangeText={(value) => updateUnit(index, { factor: value })} keyboardType="decimal-pad" hint="Example: box of 12 = 12" /></View></Row>
        <Choice title={unit.active ? 'Active unit' : 'Inactive unit'} selected={unit.active} onPress={() => updateUnit(index, { active: !unit.active })} />
        {!unit.id && units.length > 1 ? <AppButton title="Remove unit" variant="secondary" onPress={() => setUnits((current) => current.filter((_, i) => i !== index))} /> : null}
      </View>)}
      <AppButton title="Add selling unit" variant="secondary" onPress={() => setUnits((current) => [...current, { ...newUnit(), unit_name: '' }])} />
      <Row><AppButton title={busy ? 'Saving…' : 'Save product'} disabled={busy} onPress={() => void save()} />
        <AppButton title="Cancel" variant="secondary" onPress={() => setFormOpen(false)} /></Row>
    </AppCard> : null}
    <AppField label="Search products, SKU or aliases" value={search} onChangeText={setSearch} onSubmitEditing={() => void load(search)} returnKeyType="search" />
    <AppButton title="Search" variant="secondary" onPress={() => void load(search)} />
    {loading ? <ActivityIndicator color={colors.primary} /> : products.length === 0 ? <Text style={styles.muted}>No products found.</Text> :
      <View style={styles.grid}>{products.map((product) => <AppCard key={product.id} style={styles.product}>
        <Text style={styles.name}>{product.name}{product.archived_at ? ' (archived)' : ''}</Text>
        <Text style={styles.muted}>SKU {product.sku ?? '—'} · GST {decimal(product.gst_rate_bps, 2)}% · Stock {product.stock_quantity_milli == null ? 'not tracked' : decimal(product.stock_quantity_milli, 3)}</Text>
        {product.units.map((unit) => <Text key={unit.id} style={styles.muted}>{unit.unit_name}: {rupees(unit.standard_price_paise)}{unit.active ? '' : ' (inactive)'}</Text>)}
        <Row><AppButton title="Edit" variant="secondary" onPress={() => open(product)} />
          <AppButton title={product.archived_at ? 'Restore' : 'Archive'} variant="secondary" disabled={busy} onPress={() => void archive(product)} /></Row>
      </AppCard>)}</View>}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md },
  card: { gap: spacing.lg }, field: { flexGrow: 1, flexBasis: 170, minWidth: 0 },
  label: { color: colors.ink, fontWeight: '700' }, unit: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }, product: { flexGrow: 1, flexBasis: 300, minWidth: 0, gap: spacing.md },
  name: { color: colors.ink, fontSize: 18, fontWeight: '800' }, muted: { color: colors.muted }
});
