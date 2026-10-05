export type Role = "admin" | "manager" | "cashier" | "barista";

export type Session = {
  userId: string;
  username: string;
  name: string;
  role: Role;
};

export type DrinkStyle = "iced" | "hot";

export type MenuSize = {
  label: string;
  price: number;
};

export type MenuType = string;

export type MenuAddon = {
  id: string;
  name: string;
  price: number;
  qtyEnabled?: boolean;
  inventoryItemId?: string;
  usageAmount?: number;
  usageUnit?: string;
};

export type OrderAddon = {
  id: string;
  name: string;
  price: number;
  qty: number;
  inventoryItemId?: string;
  usageAmount?: number;
  usageUnit?: string;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string;
  sortOrder?: number;
  image: string;
  available: boolean;
  styles?: DrinkStyle[];
  addons?: MenuAddon[];
  types?: MenuType[];
  sizes?: MenuSize[];
};

export type OrderItem = {
  productId: string;
  name: string;
  qty: number;
  price: number;
  style?: DrinkStyle;
  size?: string;
  selectedType?: MenuType;
  category?: string;
  addons?: OrderAddon[];
};

export type PaymentMethod = "cash" | "gcash" | "maya";

export type Order = {
  id: string;
  createdAt: string;
  baristaName: string;
  items: OrderItem[];
  total: number;
  subtotal?: number;
  paymentMethod?: PaymentMethod;
  ticketNo?: string;
  paid?: number;
  change?: number;
  recordType?: "Sale" | "Purchase";
};

export type PosState = {
  isOpen: boolean;
  openedAt: string | null;
  openedBy: string | null;
};

export type StaffUser = {
  id: string;
  username: string;
  password: string;
  name: string;
  role: Role;
  title: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  cost: number;
  stock: number;
  openingStock?: number;
  maxStock: number;
  purchaseUnitSize?: number;
  cupUsageAmount?: number;
  cupsMake?: number;
};

export type RecipeIngredient = {
  inventoryItemId: string;
  name: string;
  amount: number;
  unit: string;
};

export type RecipeCosting = {
  id: string;
  name: string;
  menuItems: string[];
  ingredients: RecipeIngredient[];
  hotCupInventoryItemId?: string;
  icedCupInventoryItemId?: string;
  smallCupInventoryItemId?: string;
  largeCupInventoryItemId?: string;
  otherCupInventoryItemId?: string;
};

export type UsageLog = {
  id: string;
  orderId: string;
  orderItemId: string;
  inventoryItemId?: string;
  date: string;
  itemName: string;
  usedAmount: number;
  unit: string;
  remaining?: number;
};

export type RestockRecord = {
  id: string;
  inventoryItemId?: string;
  itemName: string;
  quantityAdded: number;
  // Purchase-facing snapshot of what the admin entered (e.g. 10 pcs) while
  // quantityAdded stays in normalized base units (e.g. 10000 ml). Nullable -
  // legacy rows predate these fields (KAN-126).
  purchaseQty?: number;
  purchaseUnit?: string;
  date: string;
};

export type CostingIngredient = {
  name: string;
  amount: number;
  unit: string;
  outputCups?: number;
};

export type CostingItem = {
  id: string;
  productName: string;
  ingredients: CostingIngredient[];
};

export type LoginActivity = {
  id: string;
  userId: string;
  username: string;
  name: string;
  role: Role;
  type: "login" | "logout";
  at: string;
};

export type StoreData = {
  pos: PosState;
  orders: Order[];
  menu: MenuItem[];
  categories: string[];
  categoryTypes: Record<string, string>;
  users: StaffUser[];
  inventory: InventoryItem[];
  recipes: Record<string, RecipeIngredient[]>;
  recipeCostings: RecipeCosting[];
  usageLogs: UsageLog[];
  restocks: RestockRecord[];
  costings: CostingItem[];
  loginActivity: LoginActivity[];
  loginGates: {
    admin: string;
    cashier: string;
  };
};
