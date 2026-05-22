use crate::domain::*;

pub struct SeedUser {
    pub id: &'static str,
    pub username: &'static str,
    pub password: &'static str,
    pub name: &'static str,
    pub role: UserRole,
}

pub struct SeedPart {
    pub id: &'static str,
    pub part_name: &'static str,
    pub part_code: &'static str,
    pub vendor: &'static str,
    pub dimensions: &'static [SeedDimension],
}

pub struct SeedDimension {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: DimensionKind,
    pub view: DimensionView,
    pub nominal: f64,
    pub upper_limit: f64,
    pub lower_limit: f64,
    pub unit: &'static str,
}

pub const USERS: &[SeedUser] = &[
    SeedUser { id: "u-001", username: "admin", password: "admin123", name: "Administrator", role: UserRole::Admin },
    SeedUser { id: "u-002", username: "supervisor", password: "super123", name: "Budi Santoso", role: UserRole::Supervisor },
    SeedUser { id: "u-003", username: "qc1", password: "qc123", name: "Sari Dewi", role: UserRole::Qc },
    SeedUser { id: "u-004", username: "operator1", password: "op123", name: "Andi Pratama", role: UserRole::Operator },
    SeedUser { id: "u-005", username: "vendor1", password: "ven123", name: "PT. Maju Jaya", role: UserRole::Vendor },
    SeedUser { id: "u-006", username: "engineer1", password: "eng123", name: "Rina Engineering", role: UserRole::Engineering },
];

const RDB_DIMENSIONS: &[SeedDimension] = &[
    SeedDimension {
        id: "d-001",
        name: "Diameter",
        kind: DimensionKind::Diameter,
        view: DimensionView::Top,
        nominal: 280.0,
        upper_limit: 280.5,
        lower_limit: 279.5,
        unit: "mm",
    },
    SeedDimension {
        id: "d-002",
        name: "Thickness",
        kind: DimensionKind::Width,
        view: DimensionView::Side,
        nominal: 22.0,
        upper_limit: 22.3,
        lower_limit: 21.7,
        unit: "mm",
    },
];

const BPS_DIMENSIONS: &[SeedDimension] = &[
    SeedDimension {
        id: "d-003",
        name: "Width",
        kind: DimensionKind::Width,
        view: DimensionView::Top,
        nominal: 55.0,
        upper_limit: 55.4,
        lower_limit: 54.6,
        unit: "mm",
    },
    SeedDimension {
        id: "d-004",
        name: "Length",
        kind: DimensionKind::Length,
        view: DimensionView::Top,
        nominal: 42.0,
        upper_limit: 42.3,
        lower_limit: 41.7,
        unit: "mm",
    },
];

pub const PARTS: &[SeedPart] = &[
    SeedPart {
        id: "p-001",
        part_name: "Rotor Disc Brake",
        part_code: "RDB-001",
        vendor: "PT. Maju Jaya",
        dimensions: RDB_DIMENSIONS,
    },
    SeedPart {
        id: "p-002",
        part_name: "Brake Pad Set",
        part_code: "BPS-002",
        vendor: "PT. Maju Jaya",
        dimensions: BPS_DIMENSIONS,
    },
];

impl From<&SeedDimension> for DimensionSpec {
    fn from(value: &SeedDimension) -> Self {
        Self {
            id: value.id.to_string(),
            name: value.name.to_string(),
            kind: value.kind,
            view: value.view,
            nominal: value.nominal,
            upper_limit: value.upper_limit,
            lower_limit: value.lower_limit,
            unit: value.unit.to_string(),
        }
    }
}
