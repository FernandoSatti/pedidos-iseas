"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Plus,
  Search,
  Package,
  CheckCircle,
  Truck,
  DollarSign,
  AlertTriangle,
  ArrowRight,
  Edit3,
  History,
  Loader2,
  User,
  Clock,
  Trash2,
  Wifi,
  WifiOff,
  RefreshCw,
} from "lucide-react"
import { OrderDialog } from "./components/order-dialog"
import { OrderDetail } from "./components/order-detail"
import { CompletedOrderSummary } from "./components/completed-order-summary"
import {
  useSupabase,
  saveCurrentUser,
  getCurrentUser,
  useBroadcastNotifications,
  useRealtimeOrders,
} from "../hooks/use-supabase"
import { NotificationSystem, useNotifications } from "../components/notification-system"
import Image from "next/image"

// ==== Tipos expuestos para los hooks ====
export type OrderStatus =
  | "en_armado"
  | "armado"
  | "armado_controlado"
  | "facturado"
  | "factura_controlada"
  | "en_transito"
  | "entregado"
  | "pagado"

export type User = {
  id: string
  name: string
  role: "vale" | "armador"
}

export type UserRole = User

export type Product = {
  id: string
  code?: string
  name: string
  quantity: number
  originalQuantity?: number
  isChecked?: boolean
  unitPrice?: number
  subtotal?: number
}

export type MissingProduct = {
  productId: string
  productName: string
  code?: string
  quantity: number
}

export type ReturnedProduct = {
  productId: string
  productName: string
  code?: string
  quantity: number
  reason?: string
}

export type HistoryEntry = {
  id: string
  action: string
  user: string
  timestamp: Date
  notes?: string
}

export type Order = {
  id: string
  clientName: string
  clientAddress: string
  products: Product[]
  status: OrderStatus
  missingProducts: MissingProduct[]
  returnedProducts: ReturnedProduct[]
  paymentMethod?: "efectivo" | "transferencia"
  isPaid: boolean
  createdAt: Date
  history: HistoryEntry[]
  armedBy?: string
  controlledBy?: string
  awaitingPaymentVerification?: boolean
  initialNotes?: string
  currentlyWorkingBy?: string
  workingStartTime?: Date
  totalAmount?: number
}

// ==== UI helpers ====
const STATUS_CONFIG = {
  en_armado: { label: "En Armado", color: "bg-yellow-500", icon: Package },
  armado: { label: "Armado", color: "bg-blue-500", icon: CheckCircle },
  armado_controlado: { label: "Armado Controlado", color: "bg-green-500", icon: CheckCircle },
  facturado: { label: "Facturado", color: "bg-purple-500", icon: DollarSign },
  factura_controlada: { label: "Factura Controlada", color: "bg-indigo-500", icon: CheckCircle },
  en_transito: { label: "En Tránsito", color: "bg-orange-500", icon: Truck },
  entregado: { label: "Entregado", color: "bg-green-600", icon: CheckCircle },
  pagado: { label: "Pagado", color: "bg-green-700", icon: DollarSign },
}

export default function OrderManagement() {
  const [orders, setOrders] = useState<Order[]>([])
  const [users, setUsers] = useState<UserRole[]>([])
  const [currentUser, setCurrentUser] = useState<UserRole | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [showOrderDialog, setShowOrderDialog] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedCompletedOrder, setSelectedCompletedOrder] = useState<Order | null>(null)
  const [activeTab, setActiveTab] = useState("active")
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all")
  const [previousOrders, setPreviousOrders] = useState<Order[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [backgroundLoading, setBackgroundLoading] = useState(false)

  const {
    loading,
    error,
    fetchOrders,
    createOrder,
    updateOrder,
    deleteOrder,
    fetchUsers,
    setWorkingOnOrder,
    clearWorkingOnOrder,
    isConnectedToSupabase,
  } = useSupabase()

  const { notifications, addNotification, removeNotification } = useNotifications()

  // ==== Refresh manual ====
  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const fresh = await fetchOrders(true, true) // fuerza + prioridad activos
      setOrders(fresh)
      addNotification("success", "Actualizado", "Datos actualizados correctamente")
      // completar fondo
      setBackgroundLoading(true)
      const all = await fetchOrders(true, false) // trae el resto
      setOrders(all)
    } catch {
      addNotification("error", "Error", "No se pudieron actualizar los datos")
    } finally {
      setIsRefreshing(false)
      setBackgroundLoading(false)
    }
  }

  // ==== Broadcast ====
  useBroadcastNotifications(currentUser?.name || "", (n) => {
    addNotification(n.type, n.title, n.message)
  })

  // ==== Realtime ====
  useRealtimeOrders(async () => {
    const fresh = await fetchOrders(true, true) // refresh rápido de activos
    setOrders(fresh)
  })

  // ==== Carga inicial progresiva ====
  useEffect(() => {
    const load = async () => {
      // usuarios rápido
      const usersData = await fetchUsers()
      setUsers(usersData)

      const saved = getCurrentUser()
      if (saved && usersData.some((u) => u.id === saved.id)) {
        setCurrentUser(saved)
      } else {
        const def = usersData.find((u) => u.name === "Vale") || usersData[0]
        if (def) {
          setCurrentUser(def)
          saveCurrentUser(def)
        }
      }

      // activos primero
      const activeFirst = await fetchOrders(false, true)
      setOrders(activeFirst)

      // completar en background
      setBackgroundLoading(true)
      const all = await fetchOrders(false, false)
      setOrders(all)
      setBackgroundLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ==== Notificaciones de cambios ====
  useEffect(() => {
    if (previousOrders.length > 0 && orders.length > 0) {
      const newOrders = orders.filter((o) => !previousOrders.some((p) => p.id === o.id))
      newOrders.forEach((o) => {
        if (currentUser?.name !== "Vale") {
          addNotification("info", "Nuevo Pedido", `Se creó el pedido para ${o.clientName}`)
        }
      })

      orders.forEach((o) => {
        const prev = previousOrders.find((p) => p.id === o.id)
        if (!prev) return
        if (prev.status !== o.status) {
          const statusLabel = STATUS_CONFIG[o.status].label
          const last = o.history[o.history.length - 1]
          if (last && last.user !== currentUser?.name) {
            addNotification("success", "Estado Actualizado", `${o.clientName} - ${statusLabel} por ${last.user}`)
          }
        }
        if (!prev.currentlyWorkingBy && o.currentlyWorkingBy && o.currentlyWorkingBy !== currentUser?.name) {
          addNotification("info", "Trabajando en Pedido", `${o.currentlyWorkingBy} está trabajando en ${o.clientName}`)
        }
      })
    }
    setPreviousOrders(orders)
  }, [orders, currentUser]) // eslint-disable-line

  // ==== Auto-poll SOLO en modo local ====
  useEffect(() => {
    if (!isConnectedToSupabase) {
      const it = setInterval(async () => {
        const data = await fetchOrders()
        setOrders(data)
      }, 15_000)
      return () => clearInterval(it)
    }
  }, [isConnectedToSupabase, fetchOrders])

  // --- Categorización base (una sola vez) ---
  const activeOrders = orders.filter((o) => o.status !== "pagado" && o.status !== "entregado")
  const pendingPaymentOrders = orders.filter((o) => o.status === "entregado" && !o.isPaid)
  const completedOrders = orders.filter((o) => o.status === "pagado")

  // --- Filtro reutilizable (una sola vez) ---
  const getFiltered = (list: Order[]) => {
    let filtered = list.filter(
      (o) =>
        o.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.id.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    if (statusFilter !== "all") filtered = filtered.filter((o) => o.status === statusFilter)
    return filtered
  }

  // --- Resultados filtrados (una sola vez) ---
  const filteredActiveOrders = getFiltered(activeOrders)
  const filteredPendingPaymentOrders = getFiltered(pendingPaymentOrders)
  const filteredCompletedOrders = getFiltered(completedOrders)

  // ==== Actions ====
  const handleCreateOrder = async (
    orderData: Omit<
      Order,
      | "id"
      | "createdAt"
      | "history"
      | "status"
      | "missingProducts"
      | "isPaid"
      | "returnedProducts"
      | "currentlyWorkingBy"
      | "workingStartTime"
    >,
  ) => {
    if (!currentUser) return
    const ok = await createOrder(orderData, currentUser)
    if (ok) {
      setShowOrderDialog(false)
      addNotification("success", "Pedido Creado", `Presupuesto para ${orderData.clientName} creado exitosamente`)
      const fresh = await fetchOrders(true, true)
      setOrders(fresh)
    } else {
      addNotification("error", "Error", "No se pudo crear el pedido. Intenta nuevamente.")
    }
  }

  const handleUpdateOrder = async (updated: Order) => {
    const ok = await updateOrder(updated, currentUser!)
    if (ok) {
      const fresh = await fetchOrders(true, true)
      setOrders(fresh)
    } else {
      addNotification("error", "Error", "No se pudo actualizar el pedido")
    }
  }

  const handleDeleteOrder = async (orderId: string) => {
    const ok = await deleteOrder(orderId)
    if (ok) {
      addNotification("info", "Pedido Eliminado", "El pedido fue eliminado correctamente")
      const fresh = await fetchOrders(true, true)
      setOrders(fresh)
    } else {
      addNotification("error", "Error", "No se pudo eliminar el pedido")
    }
  }

  const handleUserChange = (userId: string) => {
    const sel = users.find((u) => u.id === userId)
    if (sel) {
      setCurrentUser(sel)
      saveCurrentUser(sel)
      addNotification("info", "Usuario Cambiado", `Sesión cambiada a ${sel.name}`)
    }
  }

  const handleOrderSelect = async (order: Order) => {
    if (currentUser?.role === "armador" && order.status === "en_armado" && !order.currentlyWorkingBy) {
      await setWorkingOnOrder(order.id, currentUser.name, currentUser.role)
      const fresh = await fetchOrders(true, true)
      setOrders(fresh)
      const updated = fresh.find((o) => o.id === order.id)
      setSelectedOrder(updated || order)
    } else {
      setSelectedOrder(order)
    }
  }

  const handleCompletedOrderSelect = (order: Order) => setSelectedCompletedOrder(order)

  const canUserWorkOnOrder = (order: Order, user: UserRole) => {
    if (user.role === "vale") return true
    if (order.currentlyWorkingBy && order.currentlyWorkingBy !== user.name) return false
    return true
  }

  const getWorkingTime = (order: Order) => {
    if (!order.workingStartTime) return ""
    const start = order.workingStartTime instanceof Date ? order.workingStartTime : new Date(order.workingStartTime)
    if (Number.isNaN(start.getTime())) return ""
    const minutes = Math.floor((Date.now() - start.getTime()) / 60000)
    return `${minutes} min`
  }

  const getStatusIcon = (status: OrderStatus) => {
    const Icon = STATUS_CONFIG[status].icon
    return <Icon className="w-4 h-4" />
  }

  const getOrderPriorityColor = (order: Order) => {
    if (order.currentlyWorkingBy) return "border-l-4 border-l-blue-500"
    if (order.missingProducts.length > 0) return "border-l-4 border-l-orange-500"
    if (order.awaitingPaymentVerification) return "border-l-4 border-l-purple-500"
    return ""
  }

  const getNextActionForUser = (order: Order, user: UserRole) => {
    if (user.role === "armador") {
      if (order.status === "en_armado") return { label: "Armar Pedido", icon: Package }
      if (order.status === "armado" && order.armedBy !== user.name) return { label: "Controlar Armado", icon: CheckCircle }
      if (order.status === "facturado") return { label: "Controlar Factura", icon: CheckCircle }
      if (order.status === "factura_controlada") return { label: "Marcar En Tránsito", icon: Truck }
      if (order.status === "en_transito") return { label: "Marcar Entregado", icon: CheckCircle }
      if (order.status === "entregado" && !order.isPaid) return { label: "Procesar Pago", icon: DollarSign }
    }
    if (user.role === "vale") {
      if (order.status === "en_armado") return { label: "Editar Presupuesto", icon: Edit3 }
      if (order.status === "armado_controlado") return { label: "Facturar", icon: DollarSign }
      if (order.awaitingPaymentVerification) return { label: "Verificar Transferencia", icon: CheckCircle }
    }
    return null
  }

  const formatPrice = (price: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(price)

  const renderOrderCard = (order: Order, showDeleteButton = true, isCompleted = false) => {
    if (!currentUser) return null
    const nextAction = getNextActionForUser(order, currentUser)
    const canWork = canUserWorkOnOrder(order, currentUser)

    return (
      <Card
        key={order.id}
        className={`cursor-pointer hover:shadow-lg transition-shadow ${getOrderPriorityColor(order)} ${!canWork ? "opacity-75" : ""}`}
        onClick={() => (isCompleted ? handleCompletedOrderSelect(order) : handleOrderSelect(order))}
      >
        <CardHeader className="pb-3">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-lg">{order.clientName}</CardTitle>
              <CardDescription className="text-sm">ID: {order.id}</CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge className={`${STATUS_CONFIG[order.status].color} text-white flex items-center gap-1`}>
                {getStatusIcon(order.status)}
                {STATUS_CONFIG[order.status].label}
              </Badge>
              {order.awaitingPaymentVerification && (
                <Badge variant="outline" className="text-xs">
                  Esperando verificación
                </Badge>
              )}
              {order.currentlyWorkingBy && (
                <Badge variant="secondary" className="text-xs flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {order.currentlyWorkingBy}
                  {order.workingStartTime && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getWorkingTime(order)}
                    </span>
                  )}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Productos:</span>
              <span className="font-medium">{order.products.length}</span>
            </div>

            {currentUser.role === "vale" && typeof order.totalAmount === "number" && (
              <div className="flex justify-between text-sm">
                <span className="text-green-600 font-medium">Total:</span>
                <span className="font-bold text-green-600">{formatPrice(order.totalAmount)}</span>
              </div>
            )}

            {order.missingProducts.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Faltantes:
                </span>
                <span className="font-medium text-red-600">{order.missingProducts.length}</span>
              </div>
            )}

            {order.returnedProducts.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-blue-600 flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Devueltos:
                </span>
                <span className="font-medium  text-blue-600">{order.returnedProducts.length}</span>
              </div>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Creado:</span>
              <span className="font-medium">{order.createdAt.toLocaleDateString()}</span>
            </div>

            {order.armedBy && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Armado por:</span>
                <span className="font-medium">{order.armedBy}</span>
              </div>
            )}

            {order.status === "entregado" && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Pago:</span>
                <Badge variant={order.isPaid ? "default" : "destructive"}>{order.isPaid ? "Pagado" : "Pendiente"}</Badge>
              </div>
            )}

            {order.status === "pagado" && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Método de pago:</span>
                <Badge variant="outline">{order.paymentMethod === "efectivo" ? "Efectivo" : "Transferencia"}</Badge>
              </div>
            )}

            {!canWork && order.currentlyWorkingBy && (
              <div className="pt-2 border-t">
                <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {order.currentlyWorkingBy} está trabajando en este pedido
                </div>
              </div>
            )}

            {!isCompleted && nextAction && canWork && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOrderSelect(order)
                  }}
                >
                  <nextAction.icon className="w-4 h-4" />
                  {nextAction.label}
                  <ArrowRight className="w-3 h-3" />
                </Button>
              </div>
            )}

            {isCompleted && (
              <div className="pt-2 border-t">
                <div className="text-xs text-green-600 bg-green-50 p-2 rounded text-center">
                  Haz clic para ver el resumen completo
                </div>
              </div>
            )}
          </div>
        </CardContent>

        {currentUser.role === "vale" && showDeleteButton && (
          <div className="px-6 pb-4">
            <Button
              variant="destructive"
              size="sm"
              className="w-full flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`¿Eliminar el pedido de ${order.clientName}? Esta acción no se puede deshacer.`)) {
                  handleDeleteOrder(order.id)
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
              Eliminar Pedido
            </Button>
          </div>
        )}
      </Card>
    )
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Cargando sistema...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4">
                <Image src="/alfonsa-logo.png" alt="Alfonsa Distribuidora" width={80} height={80} className="object-contain" />
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">Gestión de Pedidos</h1>
                  <p className="text-gray-600 mt-1">Control completo del proceso de pedidos</p>
                  {error && <p className="text-red-600 text-sm mt-1">Error: {error}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-blue-600">
                      👤 Sesión guardada en este dispositivo: <strong>{currentUser.name}</strong>
                    </p>
                    <div className="flex items-center gap-1">
                      {isConnectedToSupabase ? (
                        <>
                          <Wifi className="w-4 h-4 text-green-600" />
                          <span className="text-xs text-green-600">Supabase conectado</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-4 h-4 text-orange-600" />
                          <span className="text-xs text-orange-600">Modo local</span>
                        </>
                      )}
                    </div>
                    {backgroundLoading && (
                      <div className="flex items-center gap-2 mt-1">
                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                        <span className="text-xs text-blue-600">Cargando más pedidos...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <a
                href="https://v0-stock-control-system-three.vercel.app/"
                rel="noopener noreferrer"
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-2 bg-white"
              >
                Control de Stock
              </a>
              <Button onClick={handleRefresh} disabled={isRefreshing || loading} variant="outline" className="flex items-center gap-2 bg-transparent">
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Actualizando..." : "Actualizar"}
              </Button>
              <select
                value={currentUser.id}
                onChange={(e) => handleUserChange(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>

              {currentUser.role === "vale" && (
                <Button onClick={() => setShowOrderDialog(true)} className="flex items-center gap-2" disabled={loading}>
                  <Plus className="w-4 h-4" />
                  Nuevo Presupuesto
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              Activos ({filteredActiveOrders.length})
            </TabsTrigger>

            <TabsTrigger value="pending-payment" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Pagos Pendientes ({filteredPendingPaymentOrders.length})
            </TabsTrigger>

            <TabsTrigger value="completed" className="flex items-center gap-2">
              <History className="w-4 h-4" />
              Completados ({filteredCompletedOrders.length})
            </TabsTrigger>
          </TabsList>

          {/* Buscador + Filtros */}
          <div className="mt-6 mb-6 flex flex-col sm:flex-row gap-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Buscar por cliente o ID de pedido..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            {activeTab === "active" && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "all")}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-xs"
              >
                <option value="all">Todos los estados</option>
                <option value="en_armado">En Armado</option>
                <option value="armado">Armado</option>
                <option value="armado_controlado">Armado Controlado</option>
                <option value="facturado">Facturado</option>
                <option value="factura_controlada">Factura Controlada</option>
                <option value="en_transito">En Tránsito</option>
              </select>
            )}
          </div>

          {/* Activos */}
          <TabsContent value="active">
            {loading && orders.length === 0 ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Cargando pedidos activos...</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredActiveOrders.map((order) => renderOrderCard(order, true, false))}
                </div>

                {filteredActiveOrders.length === 0 && (
                  <div className="text-center py-12">
                    <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pedidos activos</h3>
                    <p className="text-gray-600 mb-4">
                      {searchTerm ? "No se encontraron pedidos con ese criterio" : "Comienza creando tu primer presupuesto"}
                    </p>
                    {!searchTerm && currentUser.role === "vale" && (
                      <Button onClick={() => setShowOrderDialog(true)}>Crear Primer Presupuesto</Button>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Pagos pendientes */}
          <TabsContent value="pending-payment">
            {loading && orders.length === 0 ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Cargando pagos pendientes...</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredPendingPaymentOrders.map((order) => renderOrderCard(order, true, false))}
                </div>

                {filteredPendingPaymentOrders.length === 0 && (
                  <div className="text-center py-12">
                    <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pagos pendientes</h3>
                    <p className="text-gray-600">
                      {searchTerm
                        ? "No se encontraron pedidos con pagos pendientes con ese criterio"
                        : "Los pedidos entregados pendientes de pago aparecerán aquí"}
                    </p>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Completados */}
          <TabsContent value="completed">
            {loading && orders.length === 0 ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Cargando historial...</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredCompletedOrders.map((order) => renderOrderCard(order, true, true))}
                </div>

                {filteredCompletedOrders.length === 0 && (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pedidos completados</h3>
                    <p className="text-gray-600">
                      {searchTerm ? "No se encontraron pedidos completados con ese criterio" : "Los pedidos completados aparecerán aquí"}
                    </p>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Diálogos */}
      {currentUser.role === "vale" && (
        <OrderDialog open={showOrderDialog} onOpenChange={setShowOrderDialog} onCreateOrder={handleCreateOrder} />
      )}

      {selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          currentUser={currentUser}
          onClose={async () => {
            if (selectedOrder.currentlyWorkingBy === currentUser.name) {
              await clearWorkingOnOrder(selectedOrder.id, currentUser.name, currentUser.role)
              const fresh = await fetchOrders(true, true)
              setOrders(fresh)
            }
            setSelectedOrder(null)
          }}
          onUpdateOrder={handleUpdateOrder}
          onSetWorking={(orderId) => setWorkingOnOrder(orderId, currentUser.name, currentUser.role)}
          onClearWorking={(orderId) => clearWorkingOnOrder(orderId, currentUser.name, currentUser.role)}
        />
      )}

      {selectedCompletedOrder && (
        <CompletedOrderSummary order={selectedCompletedOrder} onClose={() => setSelectedCompletedOrder(null)} />
      )}

      {/* Notificaciones */}
      <NotificationSystem notifications={notifications} onRemove={removeNotification} />
    </div>
  )
}

