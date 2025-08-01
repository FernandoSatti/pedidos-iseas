"use client"

import { createClient } from "@supabase/supabase-js"
import { useState, useEffect } from "react"
import type { Order, User } from "../app/page"

// Verificar que las variables de entorno existan
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Crear el cliente de Supabase
export const supabase =
  supabaseUrl && supabaseKey && supabaseUrl.startsWith("http") ? createClient(supabaseUrl, supabaseKey) : null

// Usuarios por defecto (fallback si no hay Supabase)
const DEFAULT_USERS: User[] = [
  { id: "riki-1", name: "Riki", role: "vale" },
  { id: "camilo-1", name: "Camilo", role: "armador" },
  { id: "jesus-1", name: "Jesus", role: "armador" },
  { id: "eze-1", name: "Eze", role: "armador" },
]



// Funciones para manejar la persistencia del usuario por dispositivo
export const saveCurrentUser = (user: User) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("currentUser", JSON.stringify(user))
  }
}

export const getCurrentUser = (): User | null => {
  if (typeof window !== "undefined") {
    const savedUser = localStorage.getItem("currentUser")
    if (savedUser) {
      try {
        return JSON.parse(savedUser)
      } catch (error) {
        console.error("Error parsing saved user:", error)
        localStorage.removeItem("currentUser")
      }
    }
  }
  return null
}

export const clearCurrentUser = () => {
  if (typeof window !== "undefined") {
    localStorage.removeItem("currentUser")
  }
}

// Función para generar IDs únicos
const generateUniqueId = (prefix = "") => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substr(2, 9)
  return `${prefix}${timestamp}-${random}`
}

export function useSupabase() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Priorizar Supabase sobre localStorage
  const useSupabaseDB = !!supabase
  const useLocalStorage = !supabase

  // Log del estado de conexión
  useEffect(() => {
    if (useSupabaseDB) {
      console.log("✅ Conectado a Supabase - Datos en tiempo real activados")
    } else {
      console.log("⚠️ Usando localStorage - Configura Supabase para datos en tiempo real")
    }
  }, [useSupabaseDB])

  // Obtener todos los pedidos
  const fetchOrders = async (): Promise<Order[]> => {
    setLoading(true)
    setError(null)

    try {
      if (useLocalStorage) {
        // Usar localStorage como fallback
        const savedOrders = localStorage.getItem("orders")
        if (savedOrders) {
          const parsedOrders = JSON.parse(savedOrders).map((order: any) => ({
            ...order,
            createdAt: new Date(order.createdAt),
            workingStartTime: order.workingStartTime ? new Date(order.workingStartTime) : undefined,
            history: order.history.map((h: any) => ({
              ...h,
              timestamp: new Date(h.timestamp),
            })),
          }))
          return parsedOrders
        }
        return []
      }

      // Código de Supabase
      console.log("🔄 Obteniendo pedidos desde Supabase...")
      const { data: ordersData, error: ordersError } = await supabase!
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })

      if (ordersError) throw ordersError

      const orders: Order[] = []

      for (const orderData of ordersData) {
        // Obtener productos
        const { data: productsData, error: productsError } = await supabase!
          .from("products")
          .select("*")
          .eq("order_id", orderData.id)

        if (productsError) throw productsError

        // Obtener productos faltantes
        const { data: missingData, error: missingError } = await supabase!
          .from("missing_products")
          .select("*")
          .eq("order_id", orderData.id)

        if (missingError) throw missingError

        // Obtener productos devueltos
        const { data: returnedData, error: returnedError } = await supabase!
          .from("returned_products")
          .select("*")
          .eq("order_id", orderData.id)

        if (returnedError) throw returnedError

        // Obtener historial
        const { data: historyData, error: historyError } = await supabase!
          .from("order_history")
          .select("*")
          .eq("order_id", orderData.id)
          .order("created_at", { ascending: true })

        if (historyError) throw historyError

        const order: Order = {
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
          products: productsData.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            quantity: Number.parseFloat(p.quantity),
            originalQuantity: p.original_quantity ? Number.parseFloat(p.original_quantity) : undefined,
            isChecked: p.is_checked,
            unitPrice: p.unit_price ? Number.parseFloat(p.unit_price) : undefined,
            subtotal: p.subtotal ? Number.parseFloat(p.subtotal) : undefined,
          })),
          missingProducts: missingData.map((m) => ({
            productId: m.product_id,
            productName: m.product_name,
            code: m.code,
            quantity: Number.parseFloat(m.quantity),
          })),
          returnedProducts: returnedData.map((r) => ({
            productId: r.product_id,
            productName: r.product_name,
            code: r.code,
            quantity: Number.parseFloat(r.quantity),
            reason: r.reason,
          })),
          history: historyData.map((h) => ({
            id: h.id,
            action: h.action,
            user: h.user_name,
            timestamp: new Date(h.created_at),
            notes: h.notes,
          })),
        }

        orders.push(order)
      }

      console.log(`✅ ${orders.length} pedidos obtenidos desde Supabase`)
      return orders
    } catch (err) {
      console.error("❌ Error fetching orders:", err)
      setError(err instanceof Error ? err.message : "Error desconocido")
      return []
    } finally {
      setLoading(false)
    }
  }

  // Crear nuevo pedido
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

    try {
      const orderId = generateUniqueId("PED-")
      console.log("🚀 Creando pedido con ID:", orderId)

      if (useLocalStorage) {
        // Usar localStorage como fallback
        const newOrder: Order = {
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

        const savedOrders = localStorage.getItem("orders")
        const orders = savedOrders ? JSON.parse(savedOrders) : []
        orders.push(newOrder)
        localStorage.setItem("orders", JSON.stringify(orders))

        // Broadcast notification
        broadcastNotification({
          type: "info",
          title: "Nuevo Presupuesto",
          message: `Vale creó un presupuesto para ${orderData.clientName}`,
          excludeUser: currentUser.name,
        })

        return true
      }

      // Código de Supabase
      console.log("📝 Insertando orden en Supabase...")

      // Insertar orden
      const { error: orderError } = await supabase!.from("orders").insert({
        id: orderId,
        client_name: orderData.clientName,
        client_address: orderData.clientAddress,
        status: "en_armado",
        is_paid: false,
        initial_notes: orderData.initialNotes,
        total_amount: orderData.totalAmount,
      })

      if (orderError) {
        console.error("❌ Error al insertar orden:", orderError)
        throw orderError
      }

      console.log("✅ Orden creada, insertando productos...")

      // Insertar productos con IDs únicos
      const productsToInsert = orderData.products.map((product) => ({
        id: product.id || generateUniqueId("PROD-"),
        order_id: orderId,
        code: product.code,
        name: product.name,
        quantity: product.quantity,
        original_quantity: product.quantity,
        is_checked: false,
        unit_price: product.unitPrice,
        subtotal: product.subtotal,
      }))

      console.log("📦 Productos a insertar:", productsToInsert.length)

      const { error: productsError } = await supabase!.from("products").insert(productsToInsert)

      if (productsError) {
        console.error("❌ Error al insertar productos:", productsError)
        throw productsError
      }

      console.log("✅ Productos insertados, creando historial...")

      // Insertar historial
      const historyId = generateUniqueId("HIST-")
      const { error: historyError } = await supabase!.from("order_history").insert({
        id: historyId,
        order_id: orderId,
        action: "Presupuesto creado y pedido listo para armar",
        user_name: currentUser.name,
        notes: orderData.initialNotes,
      })

      if (historyError) {
        console.error("❌ Error al insertar historial:", historyError)
        throw historyError
      }

      // Broadcast notification
      broadcastNotification({
        type: "info",
        title: "Nuevo Presupuesto",
        message: `Vale creó un presupuesto para ${orderData.clientName}`,
        excludeUser: currentUser.name,
      })

      console.log("🎉 Pedido creado exitosamente:", orderId)
      return true
    } catch (err) {
      console.error("❌ Error completo al crear pedido:", err)
      setError(err instanceof Error ? err.message : "Error al crear pedido")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Marcar que un usuario está trabajando en un pedido
  const setWorkingOnOrder = async (orderId: string, userName: string, userRole: string): Promise<boolean> => {
    // Solo los armadores pueden marcar que están trabajando
    if (userRole !== "armador") return true

    try {
      if (useLocalStorage) {
        const savedOrders = localStorage.getItem("orders")
        const orders = savedOrders ? JSON.parse(savedOrders) : []
        const orderIndex = orders.findIndex((o: Order) => o.id === orderId)

        if (orderIndex >= 0) {
          orders[orderIndex].currentlyWorkingBy = userName
          orders[orderIndex].workingStartTime = new Date()
          localStorage.setItem("orders", JSON.stringify(orders))
        }
        return true
      }

      console.log(`👷 ${userName} empezó a trabajar en pedido ${orderId}`)
      const { error } = await supabase!
        .from("orders")
        .update({
          currently_working_by: userName,
          working_start_time: new Date().toISOString(),
        })
        .eq("id", orderId)

      if (error) throw error
      console.log("✅ Estado de trabajo actualizado en Supabase")
      return true
    } catch (err) {
      console.error("❌ Error setting working status:", err)
      return false
    }
  }

  // Limpiar que un usuario está trabajando en un pedido
  const clearWorkingOnOrder = async (orderId: string, userName?: string, userRole?: string): Promise<boolean> => {
    // Solo los armadores pueden limpiar el estado de trabajo
    if (userRole && userRole !== "armador") return true

    try {
      if (useLocalStorage) {
        const savedOrders = localStorage.getItem("orders")
        const orders = savedOrders ? JSON.parse(savedOrders) : []
        const orderIndex = orders.findIndex((o: Order) => o.id === orderId)

        if (orderIndex >= 0) {
          // Solo limpiar si el usuario actual es quien está trabajando o no se especifica usuario
          if (!userName || orders[orderIndex].currentlyWorkingBy === userName) {
            orders[orderIndex].currentlyWorkingBy = undefined
            orders[orderIndex].workingStartTime = undefined
            localStorage.setItem("orders", JSON.stringify(orders))
          }
        }
        return true
      }

      console.log(`🏁 ${userName || "Usuario"} terminó de trabajar en pedido ${orderId}`)
      const { error } = await supabase!
        .from("orders")
        .update({
          currently_working_by: null,
          working_start_time: null,
        })
        .eq("id", orderId)

      if (error) throw error
      console.log("✅ Estado de trabajo limpiado en Supabase")
      return true
    } catch (err) {
      console.error("❌ Error clearing working status:", err)
      return false
    }
  }

  // Actualizar pedido
  const updateOrder = async (order: Order, currentUser?: User): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      if (useLocalStorage) {
        // Usar localStorage como fallback
        const savedOrders = localStorage.getItem("orders")
        const orders = savedOrders ? JSON.parse(savedOrders) : []
        const orderIndex = orders.findIndex((o: Order) => o.id === order.id)

        if (orderIndex >= 0) {
          orders[orderIndex] = order
          localStorage.setItem("orders", JSON.stringify(orders))
        }

        // Broadcast notification si hay cambio de estado
        if (currentUser) {
          const lastHistoryEntry = order.history[order.history.length - 1]
          if (lastHistoryEntry && lastHistoryEntry.user === currentUser.name) {
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

      // Código de Supabase
      console.log(`🔄 Actualizando pedido ${order.id} en Supabase...`)

      const { error: orderError } = await supabase!
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

      if (orderError) throw orderError

      // Eliminar productos existentes y reinsertar
      await supabase!.from("products").delete().eq("order_id", order.id)

      if (order.products.length > 0) {
        const productsToInsert = order.products.map((p) => ({
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

        const { error: productsError } = await supabase!.from("products").insert(productsToInsert)

        if (productsError) throw productsError
      }

      // Eliminar y reinsertar productos faltantes
      await supabase!.from("missing_products").delete().eq("order_id", order.id)

      if (order.missingProducts.length > 0) {
        const missingToInsert = order.missingProducts.map((m) => ({
          order_id: order.id,
          product_id: m.productId,
          product_name: m.productName,
          code: m.code,
          quantity: m.quantity,
        }))

        const { error: missingError } = await supabase!.from("missing_products").insert(missingToInsert)

        if (missingError) throw missingError
      }

      // Eliminar y reinsertar productos devueltos
      await supabase!.from("returned_products").delete().eq("order_id", order.id)

      if (order.returnedProducts.length > 0) {
        const returnedToInsert = order.returnedProducts.map((r) => ({
          order_id: order.id,
          product_id: r.productId,
          product_name: r.productName,
          code: r.code,
          quantity: r.quantity,
          reason: r.reason,
        }))

        const { error: returnedError } = await supabase!.from("returned_products").insert(returnedToInsert)

        if (returnedError) throw returnedError
      }

      // Insertar nuevas entradas de historial (solo las que no existen)
      const { data: existingHistory } = await supabase!.from("order_history").select("id").eq("order_id", order.id)

      const existingIds = new Set(existingHistory?.map((h) => h.id) || [])
      const newHistoryEntries = order.history.filter((h) => !existingIds.has(h.id))

      if (newHistoryEntries.length > 0) {
        const historyToInsert = newHistoryEntries.map((h) => ({
          id: h.id || generateUniqueId("HIST-"),
          order_id: order.id,
          action: h.action,
          user_name: h.user,
          notes: h.notes,
          created_at: h.timestamp.toISOString(),
        }))

        const { error: historyError } = await supabase!.from("order_history").insert(historyToInsert)

        if (historyError) throw historyError
      }

      // Broadcast notification si hay cambio de estado
      if (currentUser) {
        const lastHistoryEntry = order.history[order.history.length - 1]
        if (lastHistoryEntry && lastHistoryEntry.user === currentUser.name) {
          broadcastNotification({
            type: "success",
            title: "Estado Actualizado",
            message: `${currentUser.name} actualizó el pedido de ${order.clientName}`,
            excludeUser: currentUser.name,
          })
        }
      }

      console.log("✅ Pedido actualizado exitosamente en Supabase")
      return true
    } catch (err) {
      console.error("❌ Error al actualizar pedido:", err)
      setError(err instanceof Error ? err.message : "Error al actualizar pedido")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Eliminar pedido
  const deleteOrder = async (orderId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      if (useLocalStorage) {
        // Usar localStorage como fallback
        const savedOrders = localStorage.getItem("orders")
        const orders = savedOrders ? JSON.parse(savedOrders) : []
        const filteredOrders = orders.filter((o: Order) => o.id !== orderId)
        localStorage.setItem("orders", JSON.stringify(filteredOrders))
        return true
      }

      // Código de Supabase
      console.log(`🗑️ Eliminando pedido ${orderId} de Supabase...`)
      const { error } = await supabase!.from("orders").delete().eq("id", orderId)
      if (error) throw error
      console.log("✅ Pedido eliminado exitosamente de Supabase")
      return true
    } catch (err) {
      console.error("❌ Error al eliminar pedido:", err)
      setError(err instanceof Error ? err.message : "Error al eliminar pedido")
      return false
    } finally {
      setLoading(false)
    }
  }

  // Obtener usuarios
  const fetchUsers = async (): Promise<User[]> => {
    if (useLocalStorage) {
      // Usar usuarios por defecto
      return DEFAULT_USERS
    }

    try {
      console.log("👥 Obteniendo usuarios desde Supabase...")
      const { data, error } = await supabase!.from("users").select("*").order("name")

      if (error) {
        console.error("❌ Error al obtener usuarios:", error)
        setError(error.message)
        return DEFAULT_USERS
      }

      const users = data.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
      }))

      console.log(`✅ ${users.length} usuarios obtenidos desde Supabase`)
      return users
    } catch (err) {
      console.error("❌ Error fetching users:", err)
      return DEFAULT_USERS
    }
  }

  return {
    loading,
    error,
    fetchOrders,
    createOrder,
    updateOrder,
    deleteOrder,
    fetchUsers,
    setWorkingOnOrder,
    clearWorkingOnOrder,
    isConnectedToSupabase: useSupabaseDB,
  }
}

// Sistema de broadcasting de notificaciones
interface BroadcastNotification {
  type: "success" | "error" | "info" | "warning"
  title: string
  message: string
  excludeUser?: string
}

const broadcastNotification = (notification: BroadcastNotification) => {
  // Usar localStorage para simular broadcasting entre pestañas
  const broadcastData = {
    ...notification,
    timestamp: Date.now(),
    id: generateUniqueId("NOTIF-"),
  }

  localStorage.setItem("broadcast_notification", JSON.stringify(broadcastData))

  // Limpiar después de un momento para evitar acumulación
  setTimeout(() => {
    localStorage.removeItem("broadcast_notification")
  }, 1000)
}

// Hook para escuchar notificaciones broadcast
export const useBroadcastNotifications = (currentUserName: string, onNotification: (notification: any) => void) => {
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === "broadcast_notification" && e.newValue) {
        try {
          const notification = JSON.parse(e.newValue)
          if (notification.excludeUser !== currentUserName) {
            onNotification(notification)
          }
        } catch (error) {
          console.error("Error parsing broadcast notification:", error)
        }
      }
    })
  }
}

// Hook para suscripciones en tiempo real de Supabase
export const useRealtimeOrders = (onOrderChange: (payload: any) => void) => {
  useEffect(() => {
    if (!supabase) return

    console.log("🔴 Configurando suscripciones en tiempo real...")

    // Suscribirse a cambios en la tabla orders
    const ordersSubscription = supabase
      .channel("orders-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        console.log("📡 Cambio en orders:", payload)
        onOrderChange(payload)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, (payload) => {
        console.log("📡 Cambio en products:", payload)
        onOrderChange(payload)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_history" }, (payload) => {
        console.log("📡 Cambio en order_history:", payload)
        onOrderChange(payload)
      })
      .subscribe()

    return () => {
      console.log("🔴 Desconectando suscripciones en tiempo real...")
      supabase.removeChannel(ordersSubscription)
    }
  }, [onOrderChange])
}
