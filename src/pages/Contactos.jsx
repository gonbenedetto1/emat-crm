
import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/components/context/WorkspaceContext";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Phone, MessageCircle, Mail, MapPin, ArrowLeft, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import ContactoWhatsAppSender from "@/components/crm/ContactoWhatsAppSender";
import { useCurrentUser } from "@/components/hooks/useCurrentUser";
import { getNextBusinessDay } from "@/components/utils/dateUtils";

export default function Contactos() {
  const [showForm, setShowForm] = useState(false);
  const [selectedContacto, setSelectedContacto] = useState(null);
  const [whatsappTarget, setWhatsappTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [filtroFuente, setFiltroFuente] = useState("todos");
  const [filtroSegmento, setFiltroSegmento] = useState("todos");
  const [formData, setFormData] = useState({
    nombre: "", empresa: "", whatsapp: "", telefonoDisplay: "",
    email: "", ciudad: "", provincia: "", segmento: "",
    canalOrigen: "", notas: ""
  });

  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();
  const { data: currentUser } = useCurrentUser();

  const { data: contactos = [], refetch, isLoading } = useQuery({
    queryKey: ["contactos", workspace?.id],
    queryFn: () => workspace
      ? base44.entities.Contacto.filter({ workspace_id: workspace.id }, "nombre", 2000)
      : [],
    enabled: !!workspace,
  });

  const { data: pipelineStages = [] } = useQuery({
    queryKey: ["pipeline-stages", workspace?.id],
    queryFn: async () => {
      if (!workspace) return [];
      const stages = await base44.entities.PipelineStage.filter({ workspace_id: workspace.id }, "orden", 100);
      return stages.filter(s => s.activa !== false);
    },
    enabled: !!workspace,
  });

  const { data: consultas = [] } = useQuery({
    queryKey: ["consultas-pipeline", workspace?.id],
    queryFn: () => workspace
      ? base44.entities.Consulta.filter({ workspace_id: workspace.id }, "-created_date", 500)
      : [],
    enabled: !!workspace,
  });

  // Extraer fuentes y segmentos dinámicamente de los datos
  const { fuentes, segmentos } = useMemo(() => {
    const fMap = {}, sMap = {};
    contactos.forEach(c => {
      if (c.canalOrigen) fMap[c.canalOrigen] = (fMap[c.canalOrigen] || 0) + 1;
      if (c.segmento) sMap[c.segmento] = (sMap[c.segmento] || 0) + 1;
    });
    return {
      fuentes: Object.entries(fMap).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, count: v })),
      segmentos: Object.entries(sMap).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, count: v })),
    };
  }, [contactos]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Contacto.create({ ...data, workspace_id: workspace?.id || "local" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contactos"] });
      toast.success("Contacto creado");
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Contacto.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contactos"] });
      toast.success("Contacto actualizado");
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Contacto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contactos"] });
      toast.success("Contacto eliminado");
    },
  });

  const createConsultaMutation = useMutation({
    mutationFn: (data) => base44.entities.Consulta.create({ ...data, workspace_id: workspace?.id || "local" }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["consultas-pipeline"] });
      toast.success(`Consulta creada en "${variables.etapa}" para ${variables.contactoNombre}`);
    },
    onError: (e) => {
      toast.error("Error al crear consulta: " + e.message);
    },
  });

  const handleMessageSent = ({ contacto: c, mensaje }) => {
  // Buscar la etapa con orden 1, si no existe entonces orden 0, si tampoco existe tomar la primera
  const primeraEtapa = pipelineStages.find(s => s.orden === 1)?.nombre
    || pipelineStages.find(s => s.orden === 0)?.nombre
    || pipelineStages[0]?.nombre;

  if (!primeraEtapa) {
    toast.error("No hay etapas en el pipeline. Crea al menos una etapa.");
    return;
  }

  const yaExiste = consultas.some(
    q => q.contactoNombre === c.nombre && q.etapa === primeraEtapa
  );

  if (yaExiste) {
    toast.info(`Ya existe una Consulta en "${primeraEtapa}" para ${c.nombre}`);
    return;
  }

  const followUpDays = currentUser?.consulta_follow_up_days ?? 3;
  const now = new Date();
  const proximoSeguimiento = getNextBusinessDay(now, followUpDays);

  createConsultaMutation.mutate({
    contactoNombre: c.nombre,
    empresa: c.empresa || "",
    contactoWhatsapp: c.whatsapp || "",
    email: c.email || "",
    canalOrigen: c.canalOrigen || "WhatsApp",
    etapa: primeraEtapa,
    primerMensaje: mensaje || "",
    fechaConsulta: now.toISOString().split("T")[0],
    mes: now.toLocaleString("es-AR", { month: "long" }).toUpperCase(),
    ano: now.getFullYear(),
    proximoSeguimiento,
  });
};

  const resetForm = () => {
    setFormData({
      nombre: "", empresa: "", whatsapp: "", telefonoDisplay: "",
      email: "", ciudad: "", provincia: "", segmento: "",
      canalOrigen: "", notas: ""
    });
    setSelectedContacto(null);
    setShowForm(false);
  };

  const handleEdit = (contacto) => {
    setSelectedContacto(contacto);
    setFormData({
      nombre: contacto.nombre || "",
      empresa: contacto.empresa || "",
      whatsapp: contacto.whatsapp || "",
      telefonoDisplay: contacto.telefonoDisplay || "",
      email: contacto.email || "",
      ciudad: contacto.ciudad || "",
      provincia: contacto.provincia || "",
      segmento: contacto.segmento || "",
      canalOrigen: contacto.canalOrigen || "",
      notas: contacto.notas || "",
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formData.nombre) {
      toast.error("El nombre es requerido");
      return;
    }
    if (selectedContacto) {
      updateMutation.mutate({ id: selectedContacto.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  // Filtrar
  const contactosFiltrados = contactos.filter(c => {
    if (search) {
      const s = search.toLowerCase();
      if (
        !c.nombre?.toLowerCase().includes(s) &&
        !c.empresa?.toLowerCase().includes(s) &&
        !c.telefonoDisplay?.toLowerCase().includes(s) &&
        !c.whatsapp?.includes(search) &&
        !c.email?.toLowerCase().includes(s) &&
        !c.ciudad?.toLowerCase().includes(s)
      ) return false;
    }
    if (filtroFuente !== "todos" && c.canalOrigen !== filtroFuente) return false;
    if (filtroSegmento !== "todos" && c.segmento !== filtroSegmento) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50/50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link to={createPageUrl("Home")}>
              <Button variant="ghost" className="gap-2 mb-2 -ml-2">
                <ArrowLeft className="w-4 h-4" />Volver
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">Contactos</h1>
            <p className="text-slate-500">
              {isLoading ? "Cargando..." : `${contactosFiltrados.length} de ${contactos.length} contactos`}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" />Nuevo contacto
          </Button>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar nombre, empresa, teléfono, email, ciudad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filtroSegmento} onValueChange={setFiltroSegmento}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Segmento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los segmentos</SelectItem>
              {segmentos.map(s => (
                <SelectItem key={s.label} value={s.label}>{s.label} ({s.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtroFuente} onValueChange={setFiltroFuente}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Fuente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas las fuentes</SelectItem>
              {fuentes.map(f => (
                <SelectItem key={f.label} value={f.label}>{f.label} ({f.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tabla */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50">
                <TableHead className="font-semibold">Contacto</TableHead>
                <TableHead className="font-semibold">Teléfono / Email</TableHead>
                <TableHead className="font-semibold">Ubicación</TableHead>
                <TableHead className="font-semibold">Segmento</TableHead>
                <TableHead className="font-semibold text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-slate-400">Cargando contactos...</TableCell>
                </TableRow>
              ) : contactosFiltrados.map(contacto => (
                <TableRow key={contacto.id} className="hover:bg-slate-50">
                  {/* Contacto */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-slate-500">
                          {(contacto.nombre || "?")[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{contacto.nombre}</p>
                        {contacto.empresa && contacto.empresa !== contacto.nombre && (
                          <p className="text-xs text-slate-500 truncate">{contacto.empresa}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Teléfono / Email */}
                  <TableCell>
                    <div className="space-y-1">
                      {(contacto.telefonoDisplay || contacto.whatsapp) ? (
                        <div className="flex items-center gap-1.5 text-sm text-slate-700">
                          <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate">{contacto.telefonoDisplay || contacto.whatsapp}</span>
                        </div>
                      ) : null}
                      {contacto.email ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail className="w-3 h-3 text-slate-300 flex-shrink-0" />
                          <span className="truncate">{contacto.email}</span>
                        </div>
                      ) : null}
                      {!contacto.telefonoDisplay && !contacto.whatsapp && !contacto.email && (
                        <span className="text-slate-300 text-xs">Sin datos de contacto</span>
                      )}
                    </div>
                  </TableCell>

                  {/* Ubicación */}
                  <TableCell>
                    {contacto.ciudad ? (
                      <div className="flex items-center gap-1 text-sm text-slate-600">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{contacto.ciudad}</span>
                      </div>
                    ) : contacto.provincia ? (
                      <span className="text-sm text-slate-500">{contacto.provincia}</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </TableCell>

                  {/* Segmento */}
                  <TableCell>
                    {contacto.segmento ? (
                      <Badge variant="secondary" className="text-xs">{contacto.segmento}</Badge>
                    ) : <span className="text-slate-300">-</span>}
                  </TableCell>

                  {/* Acciones */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => handleEdit(contacto)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      {contacto.whatsapp && (
                        <Button
                          size="sm"
                          className="bg-[#25D366] hover:bg-[#20bd5a] text-white h-8 w-8 p-0"
                          onClick={() => setWhatsappTarget(contacto)}
                        >
                          <MessageCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {!contacto.whatsapp && contacto.email && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => window.open(`mailto:${contacto.email}`, "_blank")}
                        >
                          <Mail className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                        onClick={() => {
                          if (window.confirm("¿Eliminar este contacto?")) deleteMutation.mutate(contacto.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && contactosFiltrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-slate-400">No hay contactos</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); else setShowForm(true); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedContacto ? "Editar contacto" : "Nuevo contacto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Nombre *</Label>
                <Input value={formData.nombre} onChange={e => setFormData({ ...formData, nombre: e.target.value })} placeholder="Juan Pérez" />
              </div>
              <div className="space-y-1">
                <Label>Empresa</Label>
                <Input value={formData.empresa} onChange={e => setFormData({ ...formData, empresa: e.target.value })} placeholder="Constructora SA" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Teléfono (para WhatsApp)</Label>
                <Input value={formData.whatsapp} onChange={e => setFormData({ ...formData, whatsapp: e.target.value })} placeholder="5493511234567" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="juan@email.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Ciudad</Label>
                <Input value={formData.ciudad} onChange={e => setFormData({ ...formData, ciudad: e.target.value })} placeholder="Córdoba" />
              </div>
              <div className="space-y-1">
                <Label>Provincia</Label>
                <Input value={formData.provincia} onChange={e => setFormData({ ...formData, provincia: e.target.value })} placeholder="Córdoba" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Segmento</Label>
              <Input value={formData.segmento} onChange={e => setFormData({ ...formData, segmento: e.target.value })} placeholder="Construcción y Desarrollo" />
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Textarea value={formData.notas} onChange={e => setFormData({ ...formData, notas: e.target.value })} placeholder="Observaciones..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancelar</Button>
            <Button onClick={handleSubmit}>{selectedContacto ? "Guardar" : "Crear contacto"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* WhatsApp Sender Dialog */}
      <ContactoWhatsAppSender
        open={!!whatsappTarget}
        onOpenChange={(open) => { if (!open) setWhatsappTarget(null); }}
        contacto={whatsappTarget}
        onMessageSent={handleMessageSent}
      />
    </div>
  );
}

