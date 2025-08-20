"use client"

import { createClient } from "@supabase/supabase-js"
import { useState, useEffect, useCallback } from "react"

/** ===== Tipos locales para evitar ciclo de imports ===== */
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

/** ===== ENV & CLIENT ===== */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase =
  supabaseUrl && supabaseKey && supabaseUrl.startsWith("http")
    ? createClient(supabaseUrl, supabaseKey, { realtime: { params: { eventsPerSecond: 10 } } })
    : null

/** ===== Usuarios fallback ===== */
const DEFAULT_USERS: User[] = [
  { id: "riki-1", name: "Riki", role: "vale" },
  { id: "camilo-1", name: "Camilo", role: "armador" },
  { id: "jesus-1", name: "Jesus", role: "armador" },
  { id: "eze-1", name: "Eze", role: "armador" },
  { id: "chino-1", name: "chino", role: "armador" },
]

/** ===== Persistencia de usuario ===== */
export const saveCurrentUser = (user: User) => {
  if (typeof window !== "undefined") localStorage.setItem("currentUser", JSON.stringify(user))
}
export const getCurrentUser = (): User | null => {
  if (typeof window === "undefined") return null
  const saved = localStorage.getItem("currentUser")
  if (!saved) return null
  try { return JSON.parse(saved) } catch { localStorage.removeItem("currentUser"); return null }
}
export const clearCurrentUser = () => {
  if (typeof window !== "undefined") localStorage.removeItem("currentUser")
}

/** ===== Utils ===== */
const generateUniqueId = (prefix = "") => `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

/** ===== Cache in-memory ===== */
let ordersCache: Order[] = []
let lastFetchTime = 0
const CACHE_MS = 5_000

export function useSupabase() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const useSupabaseDB = !!supabase
  const useLocalStorage = !supabase

  useEffect(() => {
    console.log(useSupabaseDB ? "✅ Supabase conectado" : "⚠️ Modo localStorage")
  }, [useSupabaseDB])

  /** ===== Mapeo ===== */
  const mapOrderRow = (orderData: any): Order => ({
    id: orderData.id,
    clientName: orderData.client_name,
    clientAddress: orderData.client_address || "",
    status: orderData.status,
    paymentMethod: orderData.payment_method,
    isPaid: orderData.is_paid,
    armedBy: orderData.armed_by,
    controlledBy: orderData.controlled_by,
    awaitingPaymentVerification: orderData.awaiting_payment_verification,
    initialNotes: orderData.initial_notes,
    createdAt: new Date(orderData.created_at),
    currentlyWorkingBy: orderData.currently_working_by,
    workingStartTime: orderData.working_start_time ? new Date(orderData.working_start_time) : undefined,
    totalAmount: orderData.total_amount ? Number.parseFloat(orderData.total_amount) : undefined,
    products: (orderData.products || []).map((p: any) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      quantity: Number.parseFloat(p.quantity),
      originalQuantity: p.original_quantity ? Number.parseFloat(p.original_quantity) : undefined,
      isChecked: p.is_checked,
      unitPrice: p.unit_price ? Number.parseFloat(p.unit_price) : undefined,
      subtotal: p.subtotal ? Number.parseFloat(p.subtotal) : undefined,
    })),
    missingProducts: (orderData.missing_products || []).map((m: any) => ({
      productId: m.product_id,
      productName: m.product_name,
      code: m.code,
      quantity: Number.parseFloat(m.quantity),
    })),
    returnedProducts: (orderData.returned_products || []).map((r: any) => ({
      productId: r.product_id,
      productName: r.product_name,
      code: r.code,
      quantity: Number.parseFloat(r.quantity),
      reason: r.reason,
    })),
    history: (orderData.order_history || [])
      .map((h: any) => ({ id: h.id, action: h.action, user: h.user_name, timestamp: new Date(h.created_at), notes: h.notes }))
      .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime()),
  })

  /** ===== Fetch (prioriza activos) ===== */
  const fetchOrders = useCallback(
    async (forceRefresh = false, prioritizeActive = false): Promise<Order[]> => {
      const now = Date.now()
      if (!forceRefresh && ordersCache.length && now - lastFetchTime < CACHE_MS) return ordersCache

      setLoading(true)
      setError(null)
      try {
        if (useLocalStorage) {
          const saved = localStorage.getItem("orders")
          if (!saved) return []
          const parsed: Order[] = JSON.parse(saved).map((o: any) => ({
            ...o,
            createdAt: new Date(o.createdAt),
            workingStartTime: o.workingStartTime ? new Date(o.workingStartTime) : undefined,
            history: (o.history || []).map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) })),
          }))
          ordersCache = parsed
          lastFetchTime = now
          return parsed
        }

        let query = supabase!
          .from("orders")
          .select(
            `
            *,
            products (*),
            missing_products (*),
            returned_products (*),
            order_history (*)
          `,
          )
          .order("created_at", { ascending: false })

        if (prioritizeActive) query = query.neq("status", "pagado").limit(60)
        else query = query.limit(200)

        const { data, error: qErr } = await query
        if (qErr) throw qErr

        const mapped = (data || []).map(mapOrderRow)
        if (prioritizeActive) {
          const previousPaid = ordersCache.filter((o) => o.status === "pagado")
          ordersCache = [...mapped, ...previousPaid]
        } else {
          ordersCache = mapped
        }
        lastFetchTime = now
        return ordersCache
      } catch (err: any) {
        console.error("❌ fetchOrders:", err)
        setError(err?.message || "Error desconocido")
        return ordersCache
      } finally {
        setLoading(false)
      }
    },
    [useLocalStorage],
  )

  /** ===== Opcional: completados ===== */
  const fetchCompletedOrders = useCallback(async (): Promise<Order[]> => {
    if (useLocalStorage) return ordersCache.filter((o) => o.status === "pagado")
    try {
      const { data, error } = await supabase!
        .from("orders")
        .select(
          `
          *,
          products (*),
          missing_products (*),
          returned_products (*),
          order_history (*)
        `,
        )
        .eq("status", "pagado")
        .order("created_at", { ascending: false })
        .limit(120)

      if (error) throw error
      const completed = (data || []).map(mapOrderRow)
      const nonPaid = ordersCache.filter((o) => o.status !== "pagado")
      ordersCache = [...nonPaid, ...completed]
      lastFetchTime = Date.now()
      return completed
    } catch {
      return []
    }
  }, [useLocalStorage])

  /** ===== Crear ===== */
  const createOrder = async (
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
    currentUser: User,
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)

    const orderId = generateUniqueId("PED-")
    const optimistic: Order = {
      ...orderData,
      id: orderId,
      status: "en_armado",
      missingProducts: [],
      returnedProducts: [],
      isPaid: false,
      createdAt: new Date(),
      history: [
        {
          id: generateUniqueId("HIST-"),
          action: "Presupuesto creado y pedido listo para armar",
          user: currentUser.name,
          timestamp: new Date(),
          notes: orderData.initialNotes || undefined,
        },
      ],
      products: orderData.products.map((p) => ({
        ...p,
        id: p.id || generateUniqueId("PROD-"),
        originalQuantity: p.quantity,
        isChecked: false,
      })),
    }
    ordersCache = [optimistic, ...ordersCache]

    try {
      if (useLocalStorage) {
        const saved = localStorage.getItem("orders")
        const list = saved ? JSON.parse(saved) : []
        list.unshift(optimistic)
        localStorage.setItem("orders", JSON.stringify(list))
        broadcastNotification({
          type: "info",
          title: "Nuevo Presupuesto",
          message: `Vale creó un presupuesto para ${orderData.clientName}`,
          excludeUser: currentUser.name,
        })
        return true
      }

      const { error: orderErr } = await supabase!.from("orders").insert({
        id: orderId,
        client_name: orderData.clientName,
        client_address: orderData.clientAddress,
        status: "en_armado",
        is_paid: false,
        initial_notes: orderData.initialNotes,
        total_amount: orderData.totalAmount,
      })
      if (orderErr) throw orderErr

      const productsToInsert = orderData.products.map((p) => ({
        id: p.id || generateUniqueId("PROD-"),
        order_id: orderId,
        code: p.code,
        name: p.name,
        quantity: p.quantity,
        original_quantity: p.quantity,
        is_checked: false,
        unit_price: p.unitPrice,
        subtotal: p.subtotal,
      }))
      const { error: prodErr } = await supabase!.from("products").insert(productsToInsert)
      if (prodErr) throw prodErr

      const { error: histErr } = await supabase!.from("order_history").insert({
        id: generateUniqueId("HIST-"),
        order_id: orderId,
        action: "Presupuesto creado y pedido listo para armar",
        user_name: currentUser.name,
        notes: orderData.initialNotes,
      })
      if (histErr) throw histErr

      broadcastNotification({
        type: "info",
        title: "Nuevo Presupuesto",
        message: `Vale creó un presupuesto para ${orderData.clientName}`,
        excludeUser: currentUser.name,
      })

      return true
    } catch (err: any) {
      ordersCache = ordersCache.filter((o) => o.id !== orderId)
      setError(err?.message || "Error al crear pedido")
      return false
    } finally {
      setLoading(false)
    }
  }

  /** ===== Working flags ===== */
  const setWorkingOnOrder = async (orderId: string, userName: string, userRole: string): Promise<boolean> => {
    if (userRole !== "armador") return true
    ordersCache = ordersCache.map((o) => (o.id === orderId ? { ...o, currentlyWorkingBy: userName, workingStartTime: new Date() } : o))
    try {
      if (useLocalStorage) {
        const saved = localStorage.getItem("orders")
        const list: Order[] = saved ? JSON.parse(saved) : []
        const i = list.findIndex((o) => o.id === orderId)
        if (i >= 0) {
          list[i].currentlyWorkingBy = userName
          list[i].workingStartTime = new Date()
          localStorage.setItem("orders", JSON.stringify(list))
        }
        return true
      }
      const { error } = await supabase!
        .from("orders")
        .update({ currently_working_by: userName, working_start_time: new Date().toISOString() })
        .eq("id", orderId)
      if (error) throw error
      return true
    } catch {
      ordersCache = ordersCache.map((o) => (o.id === orderId ? { ...o, currentlyWorkingBy: undefined, workingStartTime: undefined } : o))
      return false
    }
  }

  const clearWorkingOnOrder = async (orderId: string, userName?: string, userRole?: string): Promise<boolean> => {
    if (userRole && userRole !== "armador") return true
    ordersCache = ordersCache.map((o) => (o.id === orderId ? { ...o, currentlyWorkingBy: undefined, workingStartTime: undefined } : o))
    try {
      if (useLocalStorage) {
        const saved = localStorage.getItem("orders")
        const list: Order[] = saved ? JSON.parse(saved) : []
        const i = list.findIndex((o) => o.id === orderId)
        if (i >= 0) {
          if (!userName || list[i].currentlyWorkingBy === userName) {
            list[i].currentlyWorkingBy = undefined
            list[i].workingStartTime = undefined
            localStorage.setItem("orders", JSON.stringify(list))
          }
        }
        return true
      }
      const { error } = await supabase!.from("orders").update({ currently_working_by: null, working_start_time: null }).eq("id", orderId)
      if (error) throw error
      return true
    } catch {
      return false
    }
  }

  /** ===== Update ===== */
  const updateOrder = async (order: Order, currentUser?: User): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const i = ordersCache.findIndex((o) => o.id === order.id)
    if (i >= 0) ordersCache[i] = order
    try {
      if (useLocalStorage) {
        const saved = localStorage.getItem("orders")
        const list: Order[] = saved ? JSON.parse(saved) : []
        const idx = list.findIndex((o) => o.id === order.id)
        if (idx >= 0) {
          list[idx] = order
          localStorage.setItem("orders", JSON.stringify(list))
        }
        if (currentUser) {
          const last = order.history[order.history.length - 1]
          if (last && last.user === currentUser.name) {
            broadcastNotification({
              type: "success",
              title: "Estado Actualizado",
              message: `${currentUser.name} actualizó el pedido de ${order.clientName}`,
              excludeUser: currentUser.name,
            })
          }
        }
        return true
      }

      const { error: orderErr } = await supabase!
        .from("orders")
        .update({
          client_name: order.clientName,
          client_address: order.clientAddress,
          status: order.status,
          payment_method: order.paymentMethod,
          is_paid: order.isPaid,
          armed_by: order.armedBy,
          controlled_by: order.controlledBy,
          awaiting_payment_verification: order.awaitingPaymentVerification,
          initial_notes: order.initialNotes,
          currently_working_by: order.currentlyWorkingBy,
          working_start_time: order.workingStartTime?.toISOString(),
          total_amount: order.totalAmount,
        })
        .eq("id", order.id)
      if (orderErr) throw orderErr

      await supabase!.from("products").delete().eq("order_id", order.id)
      if (order.products.length) {
        const toInsert = order.products.map((p) => ({
          id: p.id || generateUniqueId("PROD-"),
          order_id: order.id,
          code: p.code,
          name: p.name,
          quantity: p.quantity,
          original_quantity: p.originalQuantity,
          is_checked: p.isChecked,
          unit_price: p.unitPrice,
          subtotal: p.subtotal,
        }))
        const { error: prodErr } = await supabase!.from("products").insert(toInsert)
        if (prodErr) throw prodErr
      }

      await supabase!.from("missing_products").delete().eq("order_id", order.id)
      if (order.missingProducts.length) {
        const toInsert = order.missingProducts.map((m) => ({
          order_id: order.id,
          product_id: m.productId,
          product_name: m.productName,
          code: m.code,
          quantity: m.quantity,
        }))
        const { error: missErr } = await supabase!.from("missing_products").insert(toInsert)
        if (missErr) throw missErr
      }

      await supabase!.from("returned_products").delete().eq("order_id", order.id)
      if (order.returnedProducts.length) {
        const toInsert = order.returnedProducts.map((r) => ({
          order_id: order.id,
          product_id: r.productId,
          product_name: r.productName,
          code: r.code,
          quantity: r.quantity,
          reason: r.reason,
        }))
        const { error: retErr } = await supabase!.from("returned_products").insert(toInsert)
        if (retErr) throw retErr
      }

      const { data: existing } = await supabase!.from("order_history").select("id").eq("order_id", order.id)
      const existingIds = new Set((existing || []).map((h) => h.id))
      const toHist = order.history.filter((h) => !existingIds.has(h.id))
      if (toHist.length) {
        const rows = toHist.map((h) => ({
          id: h.id || generateUniqueId("HIST-"),
          order_id: order.id,
          action: h.action,
          user_name: h.user,
          notes: h.notes,
          created_at: h.timestamp.toISOString(),
        }))
        const { error: histErr } = await supabase!.from("order_history").insert(rows)
        if (histErr) throw histErr
      }

      if (currentUser) {
        const last = order.history[order.history.length - 1]
        if (last && last.user === currentUser.name) {
          broadcastNotification({
            type: "success",
            title: "Estado Actualizado",
            message: `${currentUser.name} actualizó el pedido de ${order.clientName}`,
            excludeUser: currentUser.name,
          })
        }
      }

      return true
    } catch (err: any) {
      setError(err?.message || "Error al actualizar pedido")
      return false
    } finally {
      setLoading(false)
    }
  }

  /** ===== Delete ===== */
  const deleteOrder = async (orderId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const prev = [...ordersCache]
    ordersCache = ordersCache.filter((o) => o.id !== orderId)
    try {
      if (useLocalStorage) {
        const saved = localStorage.getItem("orders")
        const list: Order[] = saved ? JSON.parse(saved) : []
        localStorage.setItem("orders", JSON.stringify(list.filter((o) => o.id !== orderId)))
        return true
      }
      const { error } = await supabase!.from("orders").delete().eq("id", orderId)
      if (error) throw error
      return true
    } catch (err: any) {
      setError(err?.message || "Error al eliminar pedido")
      ordersCache = prev
      return false
    } finally {
      setLoading(false)
    }
  }

  /** ===== Users ===== */
  const fetchUsers = async (): Promise<User[]> => {
    if (useLocalStorage) return DEFAULT_USERS
    try {
      const { data, error } = await supabase!.from("users").select("id, name, role").order("name").limit(10)
      if (error) throw error
      return (data || []).map((u) => ({ id: u.id, name: u.name, role: u.role }))
    } catch {
      return DEFAULT_USERS
    }
  }

  return {
    loading,
    error,
    fetchOrders,
    fetchCompletedOrders,
    createOrder,
    updateOrder,
    deleteOrder,
    fetchUsers,
    setWorkingOnOrder,
    clearWorkingOnOrder,
    isConnectedToSupabase: useSupabaseDB,
  }
}

/** ===== Broadcast ===== */
interface BroadcastNotification {
  type: "success" | "error" | "info" | "warning"
  title: string
  message: string
  excludeUser?: string
}
const broadcastNotification = (notification: BroadcastNotification) => {
  const payload = { ...notification, timestamp: Date.now(), id: generateUniqueId("NOTIF-") }
  localStorage.setItem("broadcast_notification", JSON.stringify(payload))
  setTimeout(() => localStorage.removeItem("broadcast_notification"), 1000)
}

export const useBroadcastNotifications = (currentUserName: string, onNotification: (n: any) => void) => {
  useEffect(() => {
    if (typeof window === "undefined") return
    const handler = (e: StorageEvent) => {
      if (e.key !== "broadcast_notification" || !e.newValue) return
      try {
        const notif = JSON.parse(e.newValue)
        if (notif.excludeUser !== currentUserName) onNotification(notif)
      } catch (err) {
        console.error("broadcast parse:", err)
      }
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [currentUserName, onNotification])
}

/** ===== Realtime ===== */
export const useRealtimeOrders = (onOrderChange: (payload: any) => void) => {
  useEffect(() => {
    if (!supabase) return
    let channel = supabase
      .channel("orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        ordersCache = []
        onOrderChange(payload)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
        ordersCache = []
        onOrderChange(payload)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_history" }, (payload) => {
        ordersCache = []
        onOrderChange(payload)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "missing_products" }, (payload) => {
        ordersCache = []
        onOrderChange(payload)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "returned_products" }, (payload) => {
        ordersCache = []
        onOrderChange(payload)
      })
      .subscribe((status) => console.log("📡 realtime:", status))

    return () => {
      supabase.removeChannel(channel)
    }
  }, [onOrderChange])
}
