import { createApp } from 'vue'
import {
  createBootstrap,
  BAlert,
  BBadge,
  BButton,
  BCard,
  BCardBody,
  BCardHeader,
  BCol,
  BCollapse,
  BContainer,
  BDropdown,
  BDropdownItem,
  BForm,
  BFormCheckbox,
  BFormCheckboxGroup,
  BFormGroup,
  BFormInput,
  BFormSelect,
  BFormTextarea,
  BModal,
  BNavbar,
  BNavbarBrand,
  BPopover,
  BRow,
  BSpinner,
  BOrchestrator,
} from 'bootstrap-vue-next'

import './assets/styles/app.scss'
import './assets/styles/tailwind.scss'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
import '@fortawesome/fontawesome-free/css/all.min.css'

import App from './App.vue'

const app = createApp(App)

app.use(createBootstrap())

app.component('BAlert', BAlert)
app.component('BOrchestrator', BOrchestrator)
app.component('BBadge', BBadge)
app.component('BButton', BButton)
app.component('BCard', BCard)
app.component('BCardBody', BCardBody)
app.component('BCardHeader', BCardHeader)
app.component('BCol', BCol)
app.component('BCollapse', BCollapse)
app.component('BContainer', BContainer)
app.component('BDropdown', BDropdown)
app.component('BDropdownItem', BDropdownItem)
app.component('BForm', BForm)
app.component('BFormCheckbox', BFormCheckbox)
app.component('BFormCheckboxGroup', BFormCheckboxGroup)
app.component('BFormGroup', BFormGroup)
app.component('BFormInput', BFormInput)
app.component('BFormSelect', BFormSelect)
app.component('BFormTextarea', BFormTextarea)
app.component('BModal', BModal)
app.component('BNavbar', BNavbar)
app.component('BNavbarBrand', BNavbarBrand)
app.component('BPopover', BPopover)
app.component('BRow', BRow)
app.component('BSpinner', BSpinner)

app.mount('#app')
