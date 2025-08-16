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

// Tipos de datos
export type OrderStatus =
  | "en_armado"
  | "armado"
  | "armado_controlado"
  | "facturado"
  | "factura_controlada"
  | "en_transito"
  | "entregado"
  | "pagado"

export type UserRole = {
  id: string
  name: string
  role: "vale" | "armador"
}

export type Product = {
  id: string
  code?: string
  name: string
  quantity: number
  originalQuantity?: number // Para tracking de faltantes
  isChecked?: boolean // Para marcar como "bien"
  unitPrice?: number // Precio unitario (solo para Vale)
  subtotal?: number // Subtotal (solo para Vale)
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
  armedBy?: string // Quien armó el pedido
  controlledBy?: string // Quien controló el pedido
  awaitingPaymentVerification?: boolean // Para transferencias que esperan verificación de Vale
  initialNotes?: string // Observaciones iniciales de Vale
  currentlyWorkingBy?: string // Quien está trabajando actualmente en el pedido
  workingStartTime?: Date // Cuándo empezó a trabajar
  totalAmount?: number // Total del presupuesto (solo para Vale)
}

// Estados y sus colores
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

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const ordersData = await fetchOrders()
      setOrders(ordersData)
      addNotification("success", "Actualizado", "Datos actualizados correctamente")
    } catch (error) {
      addNotification("error", "Error", "No se pudieron actualizar los datos")
    } finally {
      setIsRefreshing(false)
    }
  }
  // Escuchar notificaciones broadcast
  useBroadcastNotifications(currentUser?.name || "", (notification) => {
    addNotification(notification.type, notification.title, notification.message)
  })

  // Configurar suscripciones en tiempo real de Supabase
  useRealtimeOrders((payload) => {
    console.log("🔄 Cambio detectado en tiempo real, refrescando datos...")
    // Refrescar datos cuando hay cambios
    fetchOrders().then(setOrders)
  })

  // Cargar datos iniciales
  useEffect(() => {
    const loadData = async () => {
      const [ordersData, usersData] = await Promise.all([fetchOrders(), fetchUsers()])

      setOrders(ordersData)
      setUsers(usersData)

      // Intentar cargar el usuario guardado en este dispositivo
      const savedUser = getCurrentUser()
      if (savedUser && usersData.some((u) => u.id === savedUser.id)) {
        // Si el usuario guardado existe en la lista de usuarios, usarlo
        setCurrentUser(savedUser)
      } else {
        // Si no hay usuario guardado o no existe, usar Vale por defecto
        const defaultUser = usersData.find((u) => u.name === "Vale") || usersData[0]
        if (defaultUser) {
          setCurrentUser(defaultUser)
          saveCurrentUser(defaultUser)
        }
      }
    }

    loadData()
  }, [])

  // Detectar cambios en pedidos para notificaciones
  useEffect(() => {
    if (previousOrders.length > 0 && orders.length > 0) {
      // Detectar nuevos pedidos
      const newOrders = orders.filter((order) => !previousOrders.some((prev) => prev.id === order.id))
      newOrders.forEach((order) => {
        if (currentUser?.name !== "Vale") {
          addNotification("info", "Nuevo Pedido", `Se creó el pedido para ${order.clientName}`)
        }
      })

      // Detectar cambios de estado
      orders.forEach((order) => {
        const previousOrder = previousOrders.find((prev) => prev.id === order.id)
        if (previousOrder && previousOrder.status !== order.status) {
          const statusLabel = STATUS_CONFIG[order.status].label
          const lastHistoryEntry = order.history[order.history.length - 1]
          if (lastHistoryEntry && lastHistoryEntry.user !== currentUser?.name) {
            addNotification(
              "success",
              "Estado Actualizado",
              `${order.clientName} - ${statusLabel} por ${lastHistoryEntry.user}`,
            )
          }
        }

        // Detectar cuando alguien empieza a trabajar en un pedido
        if (previousOrder && !previousOrder.currentlyWorkingBy && order.currentlyWorkingBy) {
          if (order.currentlyWorkingBy !== currentUser?.name) {
            addNotification(
              "info",
              "Trabajando en Pedido",
              `${order.currentlyWorkingBy} está trabajando en el pedido de ${order.clientName}`,
            )
          }
        }
      })
    }
    setPreviousOrders(orders)
  }, [orders, currentUser])

  // Refrescar datos automáticamente solo si no está conectado a Supabase (para localStorage)
  useEffect(() => {
    if (!isConnectedToSupabase) {
      const interval = setInterval(async () => {
        const ordersData = await fetchOrders()
        setOrders(ordersData)
      }, 15000)

      return () => clearInterval(interval)
    }
  }, [isConnectedToSupabase])

// Filtrar pedidos por categorías
  const activeOrders = orders.filter((order) => order.status !== "pagado" && order.status !== "entregado")
  const pendingPaymentOrders = orders.filter((order) => order.status === "entregado" && !order.isPaid)
  const completedOrders = orders.filter((order) => order.status === "pagado")

  // Aplicar filtro de búsqueda
  const getFilteredOrders = (ordersList: Order[]) => {
    let filtered = ordersList.filter(
      (order) =>
        order.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.id.toLowerCase().includes(searchTerm.toLowerCase()),
    )


    // Aplicar filtro por estado si no es "all"
    if (statusFilter !== "all") {
      filtered = filtered.filter((order) => order.status === statusFilter)
    }

    return filtered
  }

  const filteredActiveOrders = getFilteredOrders(activeOrders)
  const filteredPendingPaymentOrders = getFilteredOrders(pendingPaymentOrders)
  const filteredCompletedOrders = getFilteredOrders(completedOrders)

  // Crear nuevo pedido
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

    const success = await createOrder(orderData, currentUser)
    if (success) {
      setShowOrderDialog(false)
      addNotification("success", "Pedido Creado", `Presupuesto para ${orderData.clientName} creado exitosamente`)
      // Refrescar datos
      const ordersData = await fetchOrders()
      setOrders(ordersData)
    } else {
      addNotification("error", "Error", "No se pudo crear el pedido. Intenta nuevamente.")
    }
  }

  // Actualizar pedido
  const handleUpdateOrder = async (updatedOrder: Order) => {
    const success = await updateOrder(updatedOrder, currentUser)
    if (success) {
      // Refrescar datos
      const ordersData = await fetchOrders()
      setOrders(ordersData)
    } else {
      addNotification("error", "Error", "No se pudo actualizar el pedido")
    }
  }

  // Eliminar pedido
  const handleDeleteOrder = async (orderId: string) => {
    const success = await deleteOrder(orderId)
    if (success) {
      addNotification("info", "Pedido Eliminado", "El pedido fue eliminado correctamente")
      // Refrescar datos
      const ordersData = await fetchOrders()
      setOrders(ordersData)
    } else {
      addNotification("error", "Error", "No se pudo eliminar el pedido")
    }
  }

  // Manejar cambio de usuario y guardarlo en el dispositivo
  const handleUserChange = (userId: string) => {
    const selectedUser = users.find((u) => u.id === userId)
    if (selectedUser) {
      setCurrentUser(selectedUser)
      saveCurrentUser(selectedUser) // Guardar en localStorage para este dispositivo
      addNotification("info", "Usuario Cambiado", `Sesión cambiada a ${selectedUser.name}`)
    }
  }

  // Manejar cuando alguien abre un pedido para trabajar
  const handleOrderSelect = async (order: Order) => {
    // Si el usuario es un armador, el pedido está para armar y nadie más está trabajando,
    // marcar que este usuario ha comenzado a trabajar.
    if (currentUser?.role === "armador" && order.status === "en_armado" && !order.currentlyWorkingBy) {
      await setWorkingOnOrder(order.id, currentUser.name, currentUser.role)
      // Refrescar los datos para que el estado se actualice inmediatamente en la UI local
      const ordersData = await fetchOrders()
      setOrders(ordersData)
      // Buscar la orden actualizada para pasarla al detalle
      const updatedOrder = ordersData.find((o) => o.id === order.id)
      setSelectedOrder(updatedOrder || order)
    } else {
      setSelectedOrder(order)
    }
  }

  // Manejar cuando se hace clic en un pedido completado
  const handleCompletedOrderSelect = (order: Order) => {
    setSelectedCompletedOrder(order)
  }

  // Verificar si un usuario puede trabajar en un pedido
  const canUserWorkOnOrder = (order: Order, user: UserRole) => {
    // Vale siempre puede trabajar en sus pedidos
    if (user.role === "vale") return true

    // Si alguien ya está trabajando en el pedido y no es el usuario actual
    if (order.currentlyWorkingBy && order.currentlyWorkingBy !== user.name) {
      return false
    }
    return true
  }

  // Obtener el tiempo que alguien lleva trabajando en un pedido
  const getWorkingTime = (order: Order) => {
    if (!order.workingStartTime) return ""
    const start = order.workingStartTime instanceof Date ? order.workingStartTime : new Date(order.workingStartTime)
    if (Number.isNaN(start.getTime())) return ""
    const diffMs = Date.now() - start.getTime()
    const minutes = Math.floor(diffMs / 60000)
    return `${minutes} min`
  }

  const getStatusIcon = (status: OrderStatus) => {
    const IconComponent = STATUS_CONFIG[status].icon
    return <IconComponent className="w-4 h-4" />
  }

  const getOrderPriorityColor = (order: Order) => {
    if (order.currentlyWorkingBy) return "border-l-4 border-l-blue-500"
    if (order.missingProducts.length > 0) return "border-l-4 border-l-orange-500"
    if (order.awaitingPaymentVerification) return "border-l-4 border-l-purple-500"
    return ""
  }

  const getNextActionForUser = (order: Order, user: UserRole) => {
    if (user.role === "armador") {
      if (order.status === "en_armado") {
        return { label: "Armar Pedido", icon: Package }
      }
      if (order.status === "armado" && order.armedBy !== user.name) {
        return { label: "Controlar Armado", icon: CheckCircle }
      }
      if (order.status === "facturado") {
        return { label: "Controlar Factura", icon: CheckCircle }
      }
      if (order.status === "factura_controlada") {
        return { label: "Marcar En Tránsito", icon: Truck }
      }
      if (order.status === "en_transito") {
        return { label: "Marcar Entregado", icon: CheckCircle }
      }
      if (order.status === "entregado" && !order.isPaid) {
        return { label: "Procesar Pago", icon: DollarSign }
      }
    }

    if (user.role === "vale") {
      if (order.status === "en_armado") {
        return { label: "Editar Presupuesto", icon: Edit3 }
      }
      if (order.status === "armado_controlado") {
        return { label: "Facturar", icon: DollarSign }
      }
      if (order.awaitingPaymentVerification) {
        return { label: "Verificar Transferencia", icon: CheckCircle }
      }
    }

    return null
  }

  // Formatear precio en pesos argentinos
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    }).format(price)
  }

  const renderOrderCard = (order: Order, showDeleteButton = true, isCompleted = false) => {
    if (!currentUser) return null

    const nextAction = getNextActionForUser(order, currentUser)
    const canWork = canUserWorkOnOrder(order, currentUser)

    return (
      <Card
        key={order.id}
        className={`cursor-pointer hover:shadow-lg transition-shadow ${getOrderPriorityColor(order)} ${!canWork ? "opacity-75" : ""
          }`}
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

            {/* Mostrar total solo para Vale */}
            {currentUser.role === "vale" && order.totalAmount && (
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
                <Badge variant={order.isPaid ? "default" : "destructive"}>
                  {order.isPaid ? "Pagado" : "Pendiente"}
                </Badge>
              </div>
            )}

            {order.status === "pagado" && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Método de pago:</span>
                <Badge variant="outline">{order.paymentMethod === "efectivo" ? "Efectivo" : "Transferencia"}</Badge>
              </div>
            )}

            {/* Advertencia si alguien más está trabajando */}
            {!canWork && order.currentlyWorkingBy && (
              <div className="pt-2 border-t">
                <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {order.currentlyWorkingBy} está trabajando en este pedido
                </div>
              </div>
            )}

            {/* Botón de acción siguiente para pedidos activos */}
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

            {/* Mensaje para pedidos completados */}
            {isCompleted && (
              <div className="pt-2 border-t">
                <div className="text-xs text-green-600 bg-green-50 p-2 rounded text-center">
                  Haz clic para ver el resumen completo
                </div>
              </div>
            )}
          </div>
        </CardContent>

        {/* Botón de eliminar */}
        {currentUser.role === "vale" && showDeleteButton && (
          <div className="px-6 pb-4">
            <Button
              variant="destructive"
              size="sm"
              className="w-full flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation()
                if (
                  confirm(
                    `¿Estás seguro de que quieres eliminar el pedido de ${order.clientName}? Esta acción no se puede deshacer.`,
                  )
                ) {
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
                <Image
                  src="/alfonsa-logo.png"
                  alt="Alfonsa Distribuidora"
                  width={80}
                  height={80}
                  className="object-contain"
                />
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
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <a
                href="https://v0-stock-control-system-three.vercel.app/"
                //target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-2 bg-white"
              >
                Control de Stock
              </a>
              <Button
                onClick={handleRefresh}
                disabled={isRefreshing || loading}
                variant="outline"
                className="flex items-center gap-2 bg-transparent"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Actualizando..." : "Actualizar"}
              </Button>
              <select
                value={currentUser.id}
                onChange={(e) => handleUserChange(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
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

        {/* Tabs para Pedidos Activos y Completados */}
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

          
          {/* Búsqueda y Filtros */}
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

          <TabsContent value="active">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Cargando pedidos activos...</p>
              </div>
            ) : (
              <>
                {/* Lista de pedidos activos */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredActiveOrders.map((order) => renderOrderCard(order, true, false))}
                </div>

                {filteredActiveOrders.length === 0 && (
                  <div className="text-center py-12">
                    <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pedidos activos</h3>
                    <p className="text-gray-600 mb-4">
                      {searchTerm
                        ? "No se encontraron pedidos con ese criterio"
                        : "Comienza creando tu primer presupuesto"}
                    </p>
                    {!searchTerm && currentUser.role === "vale" && (
                      <Button onClick={() => setShowOrderDialog(true)}>Crear Primer Presupuesto</Button>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

<TabsContent value="pending-payment">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Cargando pagos pendientes...</p>
              </div>
            ) : (
              <>
                {/* Lista de pedidos con pagos pendientes */}
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
          <TabsContent value="completed">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Cargando historial...</p>
              </div>
            ) : (
              <>
                {/* Lista de pedidos completados */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredCompletedOrders.map((order) => renderOrderCard(order, true, true))}
                </div>

                {filteredCompletedOrders.length === 0 && (
                  <div className="text-center py-12">
                    <History className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pedidos completados</h3>
                    <p className="text-gray-600">
                      {searchTerm
                        ? "No se encontraron pedidos completados con ese criterio"
                        : "Los pedidos completados aparecerán aquí"}
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
            // Limpiar el estado de trabajo cuando se cierra el diálogo
            if (selectedOrder.currentlyWorkingBy === currentUser.name) {
              await clearWorkingOnOrder(selectedOrder.id, currentUser.name, currentUser.role)
              const ordersData = await fetchOrders()
              setOrders(ordersData)
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

      {/* Sistema de Notificaciones */}
      <NotificationSystem notifications={notifications} onRemove={removeNotification} />
    </div>
  )
}

