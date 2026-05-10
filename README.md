# 🛠️ El Serrucho GO

![Expo](https://img.shields.io/badge/Expo-52.0-000020?style=for-the-badge&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-0.76-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**El Serrucho GO** is a premium mobile dashboard designed for real-time inventory management and sales analytics for "Ferretería El Serrucho". Built with a focus on high performance, aesthetic excellence, and robust data synchronization.

---

## 🚀 Key Features

- **📊 Advanced Analytics**: Real-time sales monitoring with daily trends, profit summaries, and top-selling product insights.
- **🔄 Hybrid Sync Engine**: Seamless data synchronization between local on-site systems and the Supabase cloud backend.
- **🛡️ Role-Based Access (RBAC)**: Secure access control for Administrators and Employees with tailored interfaces.
- **📈 Interactive Visualizations**: Dynamic charts and sparklines for financial health tracking.
- **🔔 Smart Alerts**: Automated monitoring for inventory anomalies and critical system notifications.
- **💾 State Persistence**: Global search and filter parameters preserved across navigation (Zustand).
- **📱 Ultra-Responsive UI**: Optimized for all screen sizes with dynamic font scaling and flexible layouts.
- **📄 PDF Integration**: Professional report generation and document sharing (invoices, inventory lists).

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: [Expo SDK 52](https://expo.dev/) (React Native)
- **Navigation**: [Expo Router](https://docs.expo.dev/router/introduction/) (File-based routing)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) & [React Query](https://tanstack.com/query/latest)
- **Visuals**: `react-native-gifted-charts`, `react-native-svg`
- **Performance**: `@shopify/flash-list`

### Backend
- **Platform**: [Supabase](https://supabase.com/)
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Real-time**: Supabase Realtime for instant dashboard updates
- **Serverless**: Edge Functions for complex business logic

---

## 📂 Project Structure

```text
.
├── app/                # Expo Router screens and navigation
├── assets/             # Images, icons, and branding assets
├── src/
│   ├── components/     # Reusable UI components (Charts, Cards, Rows)
│   ├── hooks/          # Custom hooks for logic and data fetching
│   ├── lib/            # External service clients (Supabase)
│   ├── theme/          # Design system tokens and colors
│   └── constants/      # App-wide constants and config
├── supabase/           # SQL migrations and Edge Functions
└── eas.json            # Expo Application Services configuration
```

---

## ⚙️ Getting Started

### Prerequisites
- Node.js (Latest LTS)
- Expo Go (on physical device) or Android/iOS Emulator
- Supabase Project

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Gus2708/el-serrucho-go.git
   cd el-serrucho-go
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Start the development server**
   ```bash
   npm start
   ```

---

## 🏗️ Architecture & Decisions

- **Server-State First**: We leverage React Query for all data fetching to ensure optimal caching and background synchronization.
- **Typed Routes**: Using Expo's new typed routes for maximum developer productivity and runtime safety.
- **Modular Database**: The database is managed via versioned migrations in the `/supabase` folder, ensuring schema consistency across environments.

---

## 🤝 Contributing

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## ✨ Recent Improvements (v2.2)

- **Inventario Inteligente**: Implementación de un store global (Zustand) para persistir búsquedas y filtros al navegar entre pantallas.
- **Navegación Robusta**: Lógica de retorno inteligente en el detalle de productos para asegurar que el usuario siempre regrese al inventario.
- **Optimización Mobile**: Ajuste de tipografías dinámicas (`adjustsFontSizeToFit`) y manejo de desbordamientos en pantallas pequeñas (iPhone SE, etc).
- **Sincronización Mejorada**: Integración de indicadores de estado en tiempo real basados en la última actualización del POS.

---

<p align="center">
  Developed with ❤️ for <strong>Ferretería El Serrucho</strong>
</p>
