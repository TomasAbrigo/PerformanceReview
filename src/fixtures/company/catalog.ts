/** Static pools the generator draws from (all synthetic). */

export const COMPANY_NAME = "Meridian Andina";
export const EMAIL_DOMAIN = "meridian-andina.example";

export const FIRST_NAMES = [
  "María",
  "José",
  "Lucía",
  "Martín",
  "Sofía",
  "Mateo",
  "Valentina",
  "Santiago",
  "Camila",
  "Joaquín",
  "Julieta",
  "Nicolás",
  "Florencia",
  "Tomás",
  "Agustina",
  "Facundo",
  "Micaela",
  "Federico",
  "Carolina",
  "Gonzalo",
  "Natalia",
  "Sebastián",
  "Paula",
  "Matías",
  "Romina",
  "Ignacio",
  "Daniela",
  "Lucas",
  "Brenda",
  "Emiliano",
  "Rocío",
  "Franco",
  "Milagros",
  "Maximiliano",
  "Candela",
  "Leandro",
  "Antonella",
  "Damián",
  "Belén",
  "Ramiro",
  "Victoria",
  "Bruno",
  "Carla",
  "Esteban",
  "Gabriela",
  "Hernán",
  "Jimena",
  "Pablo",
  "Noelia",
  "Rodrigo",
  "Silvana",
  "Andrés",
  "Cecilia",
  "Diego",
  "Eugenia",
  "Fernando",
  "Ivana",
  "Javier",
  "Lorena",
  "Marcelo",
  "Patricia",
  "Ricardo",
  "Soledad",
  "Gustavo",
  "Mariana",
  "Alejandro",
  "Verónica",
  "Cristian",
  "Elena",
  "Sergio",
  "Laura",
  "Adrián",
  "Marcela",
  "Hugo",
] as const;

export const LAST_NAMES = [
  "González",
  "Rodríguez",
  "Fernández",
  "López",
  "Martínez",
  "Pérez",
  "Gómez",
  "Sánchez",
  "Romero",
  "Díaz",
  "Álvarez",
  "Torres",
  "Ruiz",
  "Ramírez",
  "Flores",
  "Benítez",
  "Acosta",
  "Medina",
  "Herrera",
  "Suárez",
  "Aguirre",
  "Giménez",
  "Gutiérrez",
  "Castro",
  "Ortiz",
  "Silva",
  "Núñez",
  "Luna",
  "Rojas",
  "Molina",
  "Cabrera",
  "Ríos",
  "Domínguez",
  "Vega",
  "Morales",
  "Navarro",
  "Peralta",
  "Sosa",
  "Figueroa",
  "Cáceres",
  "Ledesma",
  "Paz",
  "Ibáñez",
  "Quiroga",
  "Bustos",
  "Villalba",
  "Maldonado",
  "Arias",
  "Campos",
  "Correa",
  "Delgado",
  "Escobar",
  "Fuentes",
  "Garrido",
  "Ojeda",
  "Pereyra",
  "Roldán",
  "Salas",
  "Toledo",
  "Vázquez",
  "Yáñez",
  "Zárate",
  "Bravo",
  "Carrizo",
  "Duarte",
  "Esquivel",
  "Franco",
  "Godoy",
  "Heredia",
  "Juárez",
  "Lagos",
  "Márquez",
  "Nieto",
  "Olmos",
  "Páez",
  "Rivas",
  "Soria",
  "Trejo",
  "Urquiza",
  "Valdez",
  "Barrios",
  "Coronel",
  "Lezcano",
  "Monzón",
  "Reyes",
] as const;

/** Surnames reserved for the "unmatchable" CSV rows (never used by employees). */
export const OUTSIDER_NAMES = [
  "Bruno Salvatierra",
  "Eliana Corvalán",
  "Ulises Mansilla",
  "Griselda Pavón",
  "Teodoro Landívar",
  "Abril Quintana",
  "Octavio Rearte",
  "Magdalena Spinelli",
  "Ciro Valenzuela",
  "Dolores Echagüe",
  "Renzo Albornoz",
  "Marta Zabala",
] as const;

/** Short forms some people go by (Bamboo `preferredName`). */
export const NICKNAMES: Readonly<Record<string, string>> = {
  María: "Mari",
  José: "Pepe",
  Sebastián: "Seba",
  Maximiliano: "Maxi",
  Federico: "Fede",
  Alejandro: "Ale",
  Nicolás: "Nico",
  Agustina: "Agus",
  Florencia: "Flor",
  Valentina: "Vale",
  Gonzalo: "Gonza",
  Santiago: "Santi",
  Facundo: "Facu",
  Fernando: "Fer",
  Rodrigo: "Rodri",
  Candela: "Cande",
  Milagros: "Mili",
  Antonella: "Anto",
  Victoria: "Vico",
  Gabriela: "Gabi",
};

export interface DepartmentDef {
  name: string;
  /** Individual-contributor base titles; seniority is appended by the generator. */
  titles: readonly string[];
}

export interface DivisionDef {
  name: string;
  departments: readonly DepartmentDef[];
}

export const DIVISIONS: readonly DivisionDef[] = [
  {
    name: "Tecnología",
    departments: [
      {
        name: "Ingeniería",
        titles: ["Backend Developer", "Frontend Developer", "Mobile Developer"],
      },
      {
        name: "Datos",
        titles: ["Data Analyst", "Data Engineer", "Analytics Engineer"],
      },
      {
        name: "Infraestructura",
        titles: ["DevOps Engineer", "Site Reliability Engineer", "SysAdmin"],
      },
    ],
  },
  {
    name: "Comercial",
    departments: [
      {
        name: "Ventas",
        titles: ["Ejecutivo de Cuentas", "Business Developer", "Sales Analyst"],
      },
      {
        name: "Marketing",
        titles: ["Content Specialist", "Growth Analyst", "Diseñador de Marca"],
      },
      {
        name: "Customer Success",
        titles: ["Customer Success Manager", "Onboarding Specialist"],
      },
    ],
  },
  {
    name: "Operaciones",
    departments: [
      {
        name: "Soporte",
        titles: ["Agente de Soporte", "Especialista de Soporte"],
      },
      {
        name: "Operaciones",
        titles: ["Analista de Operaciones", "Coordinador de Procesos"],
      },
      {
        name: "Calidad",
        titles: ["Analista de Calidad", "Auditor de Procesos"],
      },
    ],
  },
  {
    name: "Corporativo",
    departments: [
      {
        name: "People",
        titles: ["Analista de People", "Reclutador", "HR Business Partner"],
      },
      {
        name: "Finanzas",
        titles: ["Analista Contable", "Analista de Tesorería", "Controller"],
      },
      {
        name: "Legales",
        titles: ["Abogado Corporativo", "Analista de Compliance"],
      },
    ],
  },
];

export const SENIORITY = ["Jr", "Ssr", "Sr"] as const;

export const LOCATIONS: ReadonlyArray<readonly [string, number]> = [
  ["Buenos Aires", 45],
  ["Córdoba", 20],
  ["Rosario", 10],
  ["Montevideo", 10],
  ["Santiago de Chile", 5],
  ["Remoto", 10],
];

export const TERMINATION_COMMENTS = [
  "Renuncia con preaviso de 30 días",
  "Acordó salida con su manager",
  "Cierre de la posición",
  "Se muda a otro país",
  "Nueva oportunidad en otra empresa",
] as const;

export const TERMINATION_TYPES: ReadonlyArray<{
  id: string;
  reasons: ReadonlyArray<{ id: string; label: string }>;
}> = [
  { id: "1", reasons: [{ id: "11", label: "Mejor oferta laboral" }] },
  { id: "2", reasons: [{ id: "21", label: "Reestructuración" }] },
  { id: "3", reasons: [{ id: "31", label: "Motivos personales" }] },
];
